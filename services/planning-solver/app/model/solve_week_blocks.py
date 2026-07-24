"""
Block-based CP-SAT weekly scheduler.

One optional contiguous work block per (task, worker) candidate. Start index and
assigned duration are decision variables; end time is derived from a precomputed
worker-week calendar table. Worker continuity is structural via global NoOverlap.
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import NamedTuple

from ortools.sat.python import cp_model

from app.model.candidates import pick_candidates
from app.model.work_order_collapse import (
    WoCollapseGroup,
    collapse_work_order_tasks,
    display_task_id,
    expand_collapsed_assignments,
    expand_unscheduled_warning,
    remap_previous_hours,
    synthetic_task_id,
)
from app.model.timeline import (
    QUARTERS_PER_HOUR,
    BlockPlacement,
    WorkerDayTimeline,
    WorkerPlacementCatalog,
    WorkerWeekTimeline,
    build_placement_catalog,
    minute_to_week_quarter,
)
from app.schemas import (
    BusySlotEntry,
    EngineAssignment,
    EnginePerson,
    EngineTask,
    EngineWarning,
    FixedAssignment,
    SolveRequest,
    SolveResponse,
    WorkOrderPipelineEdge,
)

logger = logging.getLogger("planning-solver")

NO_CANDIDATE_PREFIX = "NO_CANDIDATE:"

HORIZON_DAYS: int = 5
QUARTERS_PER_DAY = 24 * 4
HORIZON_Q: int = HORIZON_DAYS * QUARTERS_PER_DAY

NO_INTERLEAVE_MODE_LEGACY = "legacy"
NO_INTERLEAVE_MODE_COMPACT = "compact"

TIER_COVERAGE: int = 10**6
TIER_DEADLINE: int = 10**3
TIER_COST: int = 1
_SCALE: int = 1_000


@dataclass
class SchedulerWeights:
    coverage: float = 1.0
    deadline: float = 1.0
    urgency_scale: float = 1.0
    labor_cost: float = 1.0
    load_balance: float = 1.0
    stability: float = 0.5
    split_penalty: float = 1.0
    early_start: float = 0.3
    project_priority: float = 0.0


@dataclass(frozen=True)
class SchedulerConfig:
    horizon_days: int = HORIZON_DAYS
    max_solve_seconds: int = 240
    weights: SchedulerWeights = field(default_factory=SchedulerWeights)
    relative_gap_limit: float = 0.0
    early_stop_gap: float = 0.05


class LampEdge(NamedTuple):
    predecessor_id: str
    successor_id: str
    dry_quarters: int


@dataclass
class TaskBlock:
    task_id: str
    person_id: str
    lamp_id: str
    process: str
    week_tl: WorkerWeekTimeline
    urgency: int
    can_fragment: bool
    min_week_quarter: int


@dataclass
class BlockVars:
    block: TaskBlock
    presence: cp_model.BoolVar
    start_idx: cp_model.IntVar
    assigned_q: cp_model.IntVar
    start_wq: cp_model.IntVar
    end_wq: cp_model.IntVar
    duration_wq: cp_model.IntVar
    worker_iv: cp_model.IntervalVar
    chain_iv: cp_model.IntervalVar
    day_load: dict[int, cp_model.IntVar]


@dataclass
class ModelVars:
    all_blocks: list[BlockVars] = field(default_factory=list)
    by_task: dict[str, list[BlockVars]] = field(default_factory=dict)
    worker_ivs: dict[str, list[cp_model.IntervalVar]] = field(default_factory=dict)
    chain_ivs: dict[str, list[cp_model.IntervalVar]] = field(default_factory=dict)
    load_by_person_day: dict[tuple[str, int], list[cp_model.IntVar]] = field(
        default_factory=dict
    )


@dataclass
class ProblemData:
    tasks: list[EngineTask]
    demand_q: dict[str, int]
    days: list[date]
    week_start: date
    timelines: dict[tuple[str, int], WorkerDayTimeline]
    week_timelines: dict[str, WorkerWeekTimeline]
    process_by_code: dict
    prev_q: dict[str, int]
    people: list[EnginePerson]
    lamp_edges: list[LampEdge]
    weights: SchedulerWeights
    fixed_assignments: list[FixedAssignment]
    busy_slots: list[BusySlotEntry]
    placement_catalogs: dict[str, WorkerPlacementCatalog]
    wo_collapse: dict[str, WoCollapseGroup] = field(default_factory=dict)
    candidate_ids_by_task: dict[str, list[str]] = field(default_factory=dict)
    work_order_pipelines: list[WorkOrderPipelineEdge] = field(default_factory=list)
    candidate_ids_by_process_nave: dict[tuple[str, str], tuple[str, ...]] = field(
        default_factory=dict
    )
    people_by_id: dict[str, EnginePerson] = field(default_factory=dict)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _no_interleave_mode() -> str:
    mode = os.environ.get("PLANNING_SOLVER_NO_INTERLEAVE_MODE", NO_INTERLEAVE_MODE_LEGACY)
    if mode not in {NO_INTERLEAVE_MODE_LEGACY, NO_INTERLEAVE_MODE_COMPACT}:
        return NO_INTERLEAVE_MODE_LEGACY
    return mode


def _add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def _iso_weekday(d: date) -> int:
    return d.isoweekday()


def _block_tag(bv: BlockVars) -> str:
    b = bv.block
    return f"{b.task_id}_{b.person_id}"


def _urgency(task: EngineTask, week_start: date) -> int:
    if task.projectDeliveryDate is None:
        return 1
    days_left = (task.projectDeliveryDate.date() - week_start).days
    if days_left <= 7:
        return 4
    if days_left <= 14:
        return 2
    return 1


def _delivery_target_q(delivery: date | None, week_start: date) -> int | None:
    if delivery is None:
        return None
    d = delivery.date() if hasattr(delivery, "date") else delivery
    week_end = _add_days(week_start, HORIZON_DAYS - 1)
    if d < week_start:
        return 0
    clamped = min(d, week_end)
    day_idx = (clamped - week_start).days
    return minute_to_week_quarter(day_idx, 17 * 60)


def _task_chain_key(task: EngineTask) -> str:
    return task.lampElementId or task.lampId


def _build_lamp_edges(
    tasks: list[EngineTask],
    process_by_code: dict,
) -> list[LampEdge]:
    by_chain: dict[str, list[EngineTask]] = defaultdict(list)
    for t in tasks:
        by_chain[_task_chain_key(t)].append(t)

    edges: list[LampEdge] = []
    for group in by_chain.values():
        group.sort(key=lambda t: t.order)
        for pred, succ in zip(group, group[1:]):
            proc = process_by_code.get(pred.process)
            wait_q = (
                round(proc.waitHours * QUARTERS_PER_HOUR)
                if (proc and proc.waitHours > 0)
                else 0
            )
            edges.append(LampEdge(pred.id, succ.id, wait_q))
    return edges


def _rewire_lamp_edges(
    edges: list[LampEdge],
    member_to_synthetic: dict[str, str],
) -> list[LampEdge]:
    if not member_to_synthetic:
        return edges

    merged: dict[tuple[str, str], int] = {}
    for edge in edges:
        pred = member_to_synthetic.get(edge.predecessor_id, edge.predecessor_id)
        succ = member_to_synthetic.get(edge.successor_id, edge.successor_id)
        if pred == succ:
            continue
        key = (pred, succ)
        merged[key] = max(merged.get(key, 0), edge.dry_quarters)

    return [LampEdge(pred, succ, dry_q) for (pred, succ), dry_q in merged.items()]


def _filter_lamp_edges_for_pipeline(
    edges: list[LampEdge],
    pipelines: list[WorkOrderPipelineEdge],
    wo_collapse: dict[str, WoCollapseGroup],
) -> list[LampEdge]:
    if not pipelines or not wo_collapse:
        return edges

    pipeline_pairs = {
        (edge.predecessorWorkOrderId, edge.successorWorkOrderId)
        for edge in pipelines
    }
    wo_by_synthetic = {
        group.synthetic_id: group.work_order_id for group in wo_collapse.values()
    }

    filtered: list[LampEdge] = []
    for edge in edges:
        pred_wo = wo_by_synthetic.get(edge.predecessor_id)
        succ_wo = wo_by_synthetic.get(edge.successor_id)
        if (
            pred_wo is not None
            and succ_wo is not None
            and (pred_wo, succ_wo) in pipeline_pairs
        ):
            continue
        filtered.append(edge)
    return filtered


def _empty_timeline(person_id: str, day: date, day_index: int) -> WorkerDayTimeline:
    return WorkerDayTimeline(person_id, day, day_index, 0, (), (), 0, (), ())


def _filter_timeline_from_quarter(
    tl: WorkerDayTimeline,
    first_wq: int,
) -> WorkerDayTimeline:
    if tl.cap <= 0:
        return tl
    pairs = [(wq, ui) for wq, ui in zip(tl.week_q, tl.ui_slot) if wq >= first_wq]
    if not pairs:
        return _empty_timeline(tl.person_id, tl.day, tl.day_index)
    from app.model.timeline import _build_expanded

    wq_list_t, ui_list_t = zip(*pairs)
    wq_list = list(wq_list_t)
    ui_list = list(ui_list_t)
    wq_exp, ui_exp = _build_expanded(wq_list, ui_list)
    return WorkerDayTimeline(
        tl.person_id,
        tl.day,
        tl.day_index,
        len(wq_list),
        tuple(wq_list),
        tuple(ui_list),
        tl.contract_q,
        wq_exp,
        ui_exp,
    )


def _max_demand_by_person(
    tasks: list[EngineTask],
    people: list[EnginePerson],
    process_by_code: dict,
    candidate_cache: dict[tuple[str, str], tuple[str, ...]],
) -> dict[str, int]:
    result: dict[str, int] = defaultdict(int)
    people_by_id = {person.id: person for person in people}
    for task in tasks:
        if task.process not in process_by_code:
            continue
        demand_q = round(task.pendingHours * QUARTERS_PER_HOUR)
        if task.ownerPersonId:
            if task.ownerPersonId in people_by_id:
                result[task.ownerPersonId] = max(
                    result[task.ownerPersonId], demand_q,
                )
            continue
        for person in _task_candidates_cached(
            people_by_id,
            candidate_cache,
            task,
        ):
            result[person.id] = max(result[person.id], demand_q)
    return dict(result)


def _task_candidates_cached(
    people_by_id: dict[str, EnginePerson],
    candidate_cache: dict[tuple[str, str], tuple[str, ...]],
    task: EngineTask,
) -> list[EnginePerson]:
    candidate_ids = candidate_cache.get((task.process, task.naveId))
    if candidate_ids is None:
        return []
    return [people_by_id[candidate_id] for candidate_id in candidate_ids if candidate_id in people_by_id]


def _prepare(request: SolveRequest, config: SchedulerConfig) -> ProblemData | None:
    week_start = request.weekStart
    days = [_add_days(week_start, i) for i in range(config.horizon_days)]
    holiday_dates = {h.date for h in request.holidays}
    sched_by_person = {s.personId: s for s in request.schedules}
    absence_lookup = {(a.personId, a.date): a for a in request.absences}
    first_day = max(0, min(request.firstSchedulableDayIndex, config.horizon_days))
    first_wq = request.firstSchedulableWeekQuarter

    booked_q: dict[tuple[str, int], int] = {}
    for entry in request.bookedHours:
        day_idx = (entry.date - week_start).days
        if 0 <= day_idx < config.horizon_days:
            key = (entry.personId, day_idx)
            booked_q[key] = booked_q.get(key, 0) + round(entry.hours * QUARTERS_PER_HOUR)

    tasks = [t for t in request.tasks if round(t.pendingHours * QUARTERS_PER_HOUR) > 0]
    if not tasks and not request.fixedAssignments:
        return None

    process_by_code = {p.code: p for p in request.processes}
    fixed_task_ids = {fixed.taskId for fixed in request.fixedAssignments}
    lamp_edges = _build_lamp_edges(tasks, process_by_code)
    pipelines = list(request.workOrderPipelines)
    pipeline_wo_ids: set[str] = set()
    for edge in pipelines:
        pipeline_wo_ids.add(edge.predecessorWorkOrderId)
        pipeline_wo_ids.add(edge.successorWorkOrderId)
    tasks, wo_collapse, candidate_ids_by_task, member_to_synthetic = (
        collapse_work_order_tasks(
            tasks,
            request.people,
            fixed_task_ids=fixed_task_ids,
            skip_work_order_ids=pipeline_wo_ids,
        )
    )
    if member_to_synthetic:
        lamp_edges = _rewire_lamp_edges(lamp_edges, member_to_synthetic)
        lamp_edges = _filter_lamp_edges_for_pipeline(
            lamp_edges,
            pipelines,
            wo_collapse,
        )
        logger.info(
            "work-order collapse: groups=%d tasksBefore=%d tasksAfter=%d",
            len(wo_collapse),
            len(tasks) + sum(len(group.members) - 1 for group in wo_collapse.values()),
            len(tasks),
        )

    prev_q = remap_previous_hours(
        {entry.key: entry.quarters for entry in request.previousHours},
        wo_collapse,
    )

    timelines: dict[tuple[str, int], WorkerDayTimeline] = {}
    week_timelines: dict[str, WorkerWeekTimeline] = {}

    for person in request.people:
        s = sched_by_person.get(person.id)
        weekly = s.weekly if s else []
        overrides = s.overrides if s else []
        overrides_by_date = {override.date: override for override in overrides}
        day_tls: list[WorkerDayTimeline] = []
        for day_idx, day in enumerate(days):
            if day_idx < first_day:
                timelines[(person.id, day_idx)] = _empty_timeline(
                    person.id, day, day_idx
                )
                continue

            override = overrides_by_date.get(day)
            absence = absence_lookup.get((person.id, day))
            ab_hours = 0.0
            ab_block: tuple[int, int] | None = None
            if absence is not None:
                if (
                    absence.blockStartMinutes is not None
                    and absence.blockEndMinutes is not None
                ):
                    ab_block = (absence.blockStartMinutes, absence.blockEndMinutes)
                else:
                    ab_hours = absence.hours
            tl = WorkerDayTimeline.build(
                person.id,
                day,
                day_idx,
                _iso_weekday(day),
                weekly,
                override,
                ab_hours,
                ab_block,
                day in holiday_dates,
                person.capacityHours,
                booked_q.get((person.id, day_idx), 0),
            )
            if first_wq is not None and day_idx == first_day:
                tl = _filter_timeline_from_quarter(tl, first_wq)
            timelines[(person.id, day_idx)] = tl
            day_tls.append(tl)
        week_timelines[person.id] = WorkerWeekTimeline.build_from_days(day_tls)

    weights = _coerce_weights(request, config.weights)
    candidate_ids_by_process_nave: dict[tuple[str, str], tuple[str, ...]] = {}
    for process in process_by_code:
        for person in request.people:
            key = (process, person.naveId)
            if key in candidate_ids_by_process_nave:
                continue
            candidate_ids_by_process_nave[key] = tuple(
                candidate.id
                for candidate in pick_candidates(
                    request.people, process, task_nave_id=person.naveId
                )
            )
    max_demand_by_person = _max_demand_by_person(
        tasks,
        request.people,
        process_by_code,
        candidate_ids_by_process_nave,
    )
    placement_catalogs: dict[str, WorkerPlacementCatalog] = {}
    for person_id, week_tl in week_timelines.items():
        max_q = max_demand_by_person.get(person_id, 0)
        if max_q > 0 and week_tl.cap > 0:
            placement_catalogs[person_id] = build_placement_catalog(
                person_id,
                week_tl,
                max_q,
                config.horizon_days,
            )

    return ProblemData(
        tasks=tasks,
        demand_q={t.id: round(t.pendingHours * QUARTERS_PER_HOUR) for t in tasks},
        days=days,
        week_start=week_start,
        timelines=timelines,
        week_timelines=week_timelines,
        process_by_code=process_by_code,
        prev_q=prev_q,
        people=request.people,
        lamp_edges=lamp_edges,
        weights=weights,
        fixed_assignments=list(request.fixedAssignments),
        busy_slots=list(request.busySlots),
        placement_catalogs=placement_catalogs,
        wo_collapse=wo_collapse,
        candidate_ids_by_task=candidate_ids_by_task,
        work_order_pipelines=pipelines,
        candidate_ids_by_process_nave=candidate_ids_by_process_nave,
        people_by_id={person.id: person for person in request.people},
    )


def _coerce_weights(
    request: SolveRequest, override: SchedulerWeights
) -> SchedulerWeights:
    lw = getattr(request, "weights", None)
    if lw is None:
        return override
    return SchedulerWeights(
        coverage=getattr(lw, "wUnscheduled", override.coverage),
        deadline=getattr(lw, "wLate", override.deadline),
        labor_cost=getattr(lw, "wLaborCost", override.labor_cost),
        load_balance=getattr(lw, "wLoadBalance", override.load_balance),
        stability=getattr(lw, "wMove", override.stability),
        project_priority=getattr(lw, "wPriority", override.project_priority),
    )


def _link_block_placements(
    model: cp_model.CpModel,
    *,
    tag: str,
    presence: cp_model.BoolVar,
    placement_idx: cp_model.IntVar,
    placements: tuple[BlockPlacement, ...],
    start_idx: cp_model.IntVar,
    assigned_q: cp_model.IntVar,
    start_wq: cp_model.IntVar,
    end_wq: cp_model.IntVar,
    day_load: dict[int, cp_model.IntVar],
    demand_q: int,
    week_tl_cap: int,
) -> None:
    """Map placement_idx → block fields via AddElement (compact vs AllowedAssignments)."""
    n = len(placements)
    if n == 0:
        return

    model.Add(placement_idx >= 0).OnlyEnforceIf(presence)
    model.Add(placement_idx <= n - 1).OnlyEnforceIf(presence)

    start_idx_arr = [pl.start_idx for pl in placements]
    assigned_q_arr = [pl.assigned_q for pl in placements]
    start_wq_arr = [pl.start_wq for pl in placements]
    end_wq_arr = [pl.end_wq for pl in placements]

    elem_start_idx = model.NewIntVar(0, max(0, week_tl_cap - 1), f"esi_{tag}")
    elem_assigned_q = model.NewIntVar(0, demand_q, f"eaq_{tag}")
    elem_start_wq = model.NewIntVar(0, HORIZON_Q, f"esw_{tag}")
    elem_end_wq = model.NewIntVar(0, HORIZON_Q + 1, f"eeq_{tag}")

    model.AddElement(placement_idx, start_idx_arr, elem_start_idx)
    model.AddElement(placement_idx, assigned_q_arr, elem_assigned_q)
    model.AddElement(placement_idx, start_wq_arr, elem_start_wq)
    model.AddElement(placement_idx, end_wq_arr, elem_end_wq)

    model.Add(start_idx == elem_start_idx).OnlyEnforceIf(presence)
    model.Add(assigned_q == elem_assigned_q).OnlyEnforceIf(presence)
    model.Add(start_wq == elem_start_wq).OnlyEnforceIf(presence)
    model.Add(end_wq == elem_end_wq).OnlyEnforceIf(presence)

    for day_idx, dv in day_load.items():
        dl_arr = [pl.day_load[day_idx] for pl in placements]
        elem_dl = model.NewIntVar(0, week_tl_cap, f"edl_{tag}_{day_idx}")
        model.AddElement(placement_idx, dl_arr, elem_dl)
        model.Add(dv == elem_dl).OnlyEnforceIf(presence)


def _build_block_variables(
    model: cp_model.CpModel,
    data: ProblemData,
) -> tuple[ModelVars, int]:
    mv = ModelVars()
    placement_rows_total = 0

    for task in data.tasks:
        demand_q = data.demand_q[task.id]
        proc = data.process_by_code.get(task.process)
        if proc is None:
            continue

        for person in _task_candidates(data, task):
            catalog = data.placement_catalogs.get(person.id)
            if catalog is None:
                continue
            week_tl = catalog.week_tl

            placements = catalog.for_task(
                demand_q,
                task.minWeekQuarter or 0,
                task.canFragment,
            )
            if not placements:
                continue

            placement_rows_total += len(placements)
            n_placements = len(placements)

            tag = f"{task.id}_{person.id}"
            presence = model.NewBoolVar(f"bp_{tag}")
            placement_idx = model.NewIntVar(0, max(0, n_placements - 1), f"bpi_{tag}")
            start_idx = model.NewIntVar(0, week_tl.cap - 1, f"bi_{tag}")
            assigned_q = model.NewIntVar(0, demand_q, f"bq_{tag}")
            start_wq = model.NewIntVar(0, HORIZON_Q, f"bs_{tag}")
            end_wq = model.NewIntVar(0, HORIZON_Q + 1, f"be_{tag}")
            duration_wq = model.NewIntVar(0, HORIZON_Q + 1, f"bd_{tag}")

            day_load: dict[int, cp_model.IntVar] = {}
            for day_idx in range(HORIZON_DAYS):
                day_load[day_idx] = model.NewIntVar(
                    0, week_tl.cap, f"bdl_{tag}_{day_idx}"
                )

            _link_block_placements(
                model,
                tag=tag,
                presence=presence,
                placement_idx=placement_idx,
                placements=placements,
                start_idx=start_idx,
                assigned_q=assigned_q,
                start_wq=start_wq,
                end_wq=end_wq,
                day_load=day_load,
                demand_q=demand_q,
                week_tl_cap=week_tl.cap,
            )
            model.Add(assigned_q == 0).OnlyEnforceIf(presence.Not())
            model.Add(start_idx == 0).OnlyEnforceIf(presence.Not())
            model.Add(start_wq == 0).OnlyEnforceIf(presence.Not())
            model.Add(end_wq == 0).OnlyEnforceIf(presence.Not())
            for day_idx in range(HORIZON_DAYS):
                model.Add(day_load[day_idx] == 0).OnlyEnforceIf(presence.Not())
            model.Add(duration_wq == end_wq - start_wq).OnlyEnforceIf(presence)
            model.Add(duration_wq == 0).OnlyEnforceIf(presence.Not())

            worker_iv = model.NewOptionalIntervalVar(
                start_wq, duration_wq, end_wq, presence, f"wiv_{tag}"
            )
            chain_iv = model.NewOptionalIntervalVar(
                start_wq, duration_wq, end_wq, presence, f"civ_{tag}"
            )

            block = TaskBlock(
                task_id=task.id,
                person_id=person.id,
                lamp_id=task.lampId,
                process=task.process,
                week_tl=week_tl,
                urgency=_urgency(task, data.week_start),
                can_fragment=task.canFragment,
                min_week_quarter=task.minWeekQuarter or 0,
            )
            bv = BlockVars(
                block=block,
                presence=presence,
                start_idx=start_idx,
                assigned_q=assigned_q,
                start_wq=start_wq,
                end_wq=end_wq,
                duration_wq=duration_wq,
                worker_iv=worker_iv,
                chain_iv=chain_iv,
                day_load=day_load,
            )
            mv.all_blocks.append(bv)
            mv.by_task.setdefault(task.id, []).append(bv)
            mv.worker_ivs.setdefault(person.id, []).append(worker_iv)
            mv.chain_ivs.setdefault(_task_chain_key(task), []).append(chain_iv)
            for day_idx, dv in day_load.items():
                mv.load_by_person_day.setdefault((person.id, day_idx), []).append(dv)

    return mv, placement_rows_total


def _task_candidates(data: ProblemData, task: EngineTask) -> list[EnginePerson]:
    if task.ownerPersonId:
        person = data.people_by_id.get(task.ownerPersonId)
        return [person] if person and person.naveId == task.naveId else []
    override_ids = data.candidate_ids_by_task.get(task.id)
    if override_ids is not None:
        allowed = set(override_ids)
        return [
            person
            for person in data.people
            if person.id in allowed and person.naveId == task.naveId
        ]
    candidates = data.candidate_ids_by_process_nave.get((task.process, task.naveId))
    if candidates is None:
        return []
    return [
        data.people_by_id[candidate_id]
        for candidate_id in candidates
        if candidate_id in data.people_by_id
    ]


def _block_debug_rows(data: ProblemData, mv: ModelVars) -> list[dict]:
    rows: list[dict] = []
    for task in data.tasks:
        blocks = mv.by_task.get(task.id, [])
        cand = _task_candidates(data, task)
        rows.append(
            {
                "taskId": task.id,
                "process": task.process,
                "pendingHours": task.pendingHours,
                "candidateCount": len(cand),
                "blockCount": len(blocks),
            }
        )
    return rows


def _diagnose_no_candidate(data: ProblemData, task: EngineTask) -> str:
    if task.process not in data.process_by_code:
        return (
            f"{NO_CANDIDATE_PREFIX} El proceso «{task.process}» no está en el catálogo."
        )
    candidates = _task_candidates(data, task)
    if not candidates:
        any_specialty = [
            person
            for person in data.people
            if task.process in person.primary or task.process in person.fallback
        ]
        if any_specialty:
            return (
                f"{NO_CANDIDATE_PREFIX} Ningún operario de la nave tiene el proceso "
                f"«{task.process}» configurado (primary/fallback)."
            )
        return (
            f"{NO_CANDIDATE_PREFIX} Ningún operario tiene el proceso "
            f"«{task.process}» configurado (primary/fallback)."
        )
    return (
        f"{NO_CANDIDATE_PREFIX} Los operarios de «{task.process}» "
        "no tienen capacidad disponible en esta semana."
    )


def _find_unplannable_warnings(
    data: ProblemData,
    mv: ModelVars,
) -> list[EngineWarning]:
    warnings: list[EngineWarning] = []
    no_block_task_ids: set[str] = set()
    task_by_id = {t.id: t for t in data.tasks}

    for task in data.tasks:
        if mv.by_task.get(task.id):
            continue
        warnings.append(
            EngineWarning(taskId=task.id, reason=_diagnose_no_candidate(data, task))
        )
        no_block_task_ids.add(task.id)

    for edge in data.lamp_edges:
        if edge.predecessor_id not in no_block_task_ids:
            continue
        if edge.successor_id in no_block_task_ids:
            continue
        pred = task_by_id.get(edge.predecessor_id)
        succ = task_by_id.get(edge.successor_id)
        if pred is None or succ is None:
            continue
        warnings.append(
            EngineWarning(
                taskId=edge.successor_id,
                reason=(
                    f"{NO_CANDIDATE_PREFIX} No se puede planificar «{succ.process}» "
                    f"porque el proceso anterior «{pred.process}» no tiene operario "
                    "o capacidad en esta semana."
                ),
            )
        )
        no_block_task_ids.add(edge.successor_id)

    return warnings


def _add_constraints(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> dict[str, cp_model.IntVar]:
    unscheduled: dict[str, cp_model.IntVar] = {}

    for task in data.tasks:
        pq = data.demand_q[task.id]
        u = model.NewIntVar(0, pq, f"u_{task.id}")
        unscheduled[task.id] = u
        blocks = mv.by_task.get(task.id, [])
        if blocks:
            model.Add(sum(bv.assigned_q for bv in blocks) + u == pq)
        else:
            model.Add(u == pq)

    for ivs in mv.worker_ivs.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    for ivs in mv.chain_ivs.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    by_wo = _tasks_by_work_order(data.tasks)
    _add_lamp_ordering(model, data, mv)
    _add_work_order_constraints(model, data, mv, by_wo)
    _add_work_order_pipeline_constraints(model, data, mv)
    if _no_interleave_mode() == NO_INTERLEAVE_MODE_COMPACT:
        _add_work_order_no_interleave_compact(model, mv, by_wo)
    else:
        _add_work_order_no_interleave(model, mv, by_wo)
    _add_max_one_worker_per_task(model, data, mv)

    return unscheduled


def _tasks_by_work_order(tasks: list[EngineTask]) -> dict[str, list[EngineTask]]:
    by_wo: dict[str, list[EngineTask]] = defaultdict(list)
    for task in tasks:
        if task.workOrderId:
            by_wo[task.workOrderId].append(task)
    for group in by_wo.values():
        group.sort(key=lambda t: t.workOrderSequence or 0)
    return by_wo


def _add_work_order_constraints(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    by_wo: dict[str, list[EngineTask]] | None = None,
) -> None:
    if by_wo is None:
        by_wo = _tasks_by_work_order(data.tasks)
    for wo_id, wo_tasks in by_wo.items():
        if len(wo_tasks) < 2:
            continue

        blocks_by_person: dict[str, list[BlockVars]] = defaultdict(list)
        for task in wo_tasks:
            for bv in mv.by_task.get(task.id, []):
                blocks_by_person[bv.block.person_id].append(bv)

        # Un operario por OT, pero presence independiente por tarea: permite cortar
        # la OT al final de la ventana y continuar la semana siguiente.
        person_active: list[cp_model.BoolVar] = []
        for person_id, person_blocks in blocks_by_person.items():
            if not person_blocks:
                continue
            if len(person_blocks) == 1:
                person_active.append(person_blocks[0].presence)
                continue
            active = model.NewBoolVar(f"wo_active_{wo_id}_{person_id}")
            model.AddBoolOr([bv.presence for bv in person_blocks]).OnlyEnforceIf(active)
            model.AddBoolAnd(
                [bv.presence.Not() for bv in person_blocks],
            ).OnlyEnforceIf(active.Not())
            person_active.append(active)

        if len(person_active) > 1:
            model.Add(sum(person_active) <= 1)

        for pred, succ in zip(wo_tasks, wo_tasks[1:]):
            pred_demand = data.demand_q.get(pred.id, 0)
            if pred_demand <= 0:
                continue

            pred_blocks = mv.by_task.get(pred.id, [])
            succ_blocks = mv.by_task.get(succ.id, [])
            if not pred_blocks or not succ_blocks:
                continue

            pred_done = model.NewBoolVar(f"wo_done_{pred.id}")
            total_pred = model.NewIntVar(0, pred_demand, f"wo_tp_{pred.id}")
            model.Add(total_pred == sum(bv.assigned_q for bv in pred_blocks))
            model.Add(total_pred == pred_demand).OnlyEnforceIf(pred_done)
            model.Add(total_pred < pred_demand).OnlyEnforceIf(pred_done.Not())

            pred_end_terms: list = []
            for bv in pred_blocks:
                contrib = model.NewIntVar(0, HORIZON_Q + 1, f"wo_pec_{_block_tag(bv)}")
                model.Add(contrib == bv.end_wq).OnlyEnforceIf(bv.presence)
                model.Add(contrib == 0).OnlyEnforceIf(bv.presence.Not())
                pred_end_terms.append(contrib)

            pred_end = model.NewIntVar(0, HORIZON_Q + 1, f"wo_pend_{pred.id}")
            if pred_end_terms:
                model.AddMaxEquality(pred_end, pred_end_terms)
            else:
                model.Add(pred_end == 0)

            earliest = model.NewIntVar(0, HORIZON_Q + 1, f"wo_early_{succ.id}")
            model.Add(earliest == pred_end).OnlyEnforceIf(pred_done)
            model.Add(earliest == HORIZON_Q + 1).OnlyEnforceIf(pred_done.Not())

            for bv in succ_blocks:
                model.Add(bv.start_wq >= earliest).OnlyEnforceIf(bv.presence)
                model.Add(bv.presence == 0).OnlyEnforceIf(pred_done.Not())


def _add_work_order_pipeline_constraints(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    """OT sucesora puede empezar tras horas mínimas de la predecesora (OT colapsadas)."""
    if not data.work_order_pipelines:
        return

    for edge in data.work_order_pipelines:
        threshold_q = round(edge.minCompletedHours * QUARTERS_PER_HOUR)
        if threshold_q <= 0:
            continue

        pred_id = synthetic_task_id(edge.predecessorWorkOrderId)
        succ_id = synthetic_task_id(edge.successorWorkOrderId)
        pred_blocks = mv.by_task.get(pred_id, [])
        succ_blocks = mv.by_task.get(succ_id, [])
        if not pred_blocks or not succ_blocks:
            continue

        pred_demand = data.demand_q.get(pred_id, 0)
        if pred_demand <= 0:
            continue

        tag = f"{edge.predecessorWorkOrderId}_{edge.successorWorkOrderId}"
        partial_done = model.NewBoolVar(f"wo_pipe_done_{tag}")
        total_pred = model.NewIntVar(0, pred_demand, f"wo_pipe_tp_{tag}")
        model.Add(total_pred == sum(bv.assigned_q for bv in pred_blocks))
        model.Add(total_pred >= threshold_q).OnlyEnforceIf(partial_done)
        model.Add(total_pred < threshold_q).OnlyEnforceIf(partial_done.Not())

        partial_end_terms: list = []
        for bv in pred_blocks:
            ended = model.NewIntVar(0, HORIZON_Q + 1, f"wo_pipe_pe_{tag}_{_block_tag(bv)}")
            model.Add(ended == bv.start_wq + threshold_q).OnlyEnforceIf(
                [bv.presence, partial_done],
            )
            model.Add(ended == HORIZON_Q + 1).OnlyEnforceIf(bv.presence.Not())
            model.Add(ended == HORIZON_Q + 1).OnlyEnforceIf(partial_done.Not())
            partial_end_terms.append(ended)

        partial_end = model.NewIntVar(0, HORIZON_Q + 1, f"wo_pipe_pend_{tag}")
        if partial_end_terms:
            model.AddMinEquality(partial_end, partial_end_terms)
        else:
            model.Add(partial_end == HORIZON_Q + 1)

        earliest = model.NewIntVar(0, HORIZON_Q + 1, f"wo_pipe_early_{tag}")
        model.Add(earliest == partial_end).OnlyEnforceIf(partial_done)
        model.Add(earliest == HORIZON_Q + 1).OnlyEnforceIf(partial_done.Not())

        for bv in succ_blocks:
            model.Add(bv.start_wq >= earliest).OnlyEnforceIf(bv.presence)
            model.Add(bv.presence == 0).OnlyEnforceIf(partial_done.Not())


def _add_work_order_no_interleave(
    model: cp_model.CpModel,
    mv: ModelVars,
    by_wo: dict[str, list[EngineTask]],
) -> None:
    """Once a worker starts an OT, no other task may be scheduled between its blocks."""
    if not by_wo:
        return

    blocks_by_person: dict[str, list[BlockVars]] = defaultdict(list)
    for bv in mv.all_blocks:
        blocks_by_person[bv.block.person_id].append(bv)

    horizon = HORIZON_Q + 1
    for wo_id, wo_tasks in by_wo.items():
        # Una sola tarea en la OT: un bloque contiguo; NoOverlap del operario ya basta.
        if len(wo_tasks) < 2:
            continue

        wo_task_ids = {task.id for task in wo_tasks}
        persons: set[str] = set()
        for task in wo_tasks:
            for bv in mv.by_task.get(task.id, []):
                persons.add(bv.block.person_id)

        for person_id in persons:
            ot_blocks = [
                bv
                for task in wo_tasks
                for bv in mv.by_task.get(task.id, [])
                if bv.block.person_id == person_id
            ]
            if not ot_blocks:
                continue

            if len(ot_blocks) == 1:
                wo_active = ot_blocks[0].presence
            else:
                wo_active = model.NewBoolVar(f"wo_ni_active_{wo_id}_{person_id}")
                model.AddBoolOr([bv.presence for bv in ot_blocks]).OnlyEnforceIf(
                    wo_active,
                )
                model.AddBoolAnd(
                    [bv.presence.Not() for bv in ot_blocks],
                ).OnlyEnforceIf(wo_active.Not())

            wo_start = model.NewIntVar(0, horizon, f"wo_ns_{wo_id}_{person_id}")
            wo_end = model.NewIntVar(0, horizon, f"wo_ne_{wo_id}_{person_id}")

            start_terms: list = []
            end_terms: list = []
            for bv in ot_blocks:
                start_fv = model.NewIntVar(0, horizon, f"wo_nss_{wo_id}_{_block_tag(bv)}")
                model.Add(start_fv == bv.start_wq).OnlyEnforceIf(bv.presence)
                model.Add(start_fv == horizon).OnlyEnforceIf(bv.presence.Not())
                start_terms.append(start_fv)

                end_fv = model.NewIntVar(0, horizon, f"wo_nse_{wo_id}_{_block_tag(bv)}")
                model.Add(end_fv == bv.end_wq).OnlyEnforceIf(bv.presence)
                model.Add(end_fv == 0).OnlyEnforceIf(bv.presence.Not())
                end_terms.append(end_fv)

            model.AddMinEquality(wo_start, start_terms)
            model.AddMaxEquality(wo_end, end_terms)

            for foreign in blocks_by_person.get(person_id, []):
                if foreign.block.task_id in wo_task_ids:
                    continue

                before = model.NewBoolVar(
                    f"wo_nfb_{wo_id}_{person_id}_{_block_tag(foreign)}",
                )
                after = model.NewBoolVar(
                    f"wo_nfa_{wo_id}_{person_id}_{_block_tag(foreign)}",
                )
                model.Add(foreign.end_wq <= wo_start).OnlyEnforceIf(before)
                model.Add(foreign.start_wq >= wo_end).OnlyEnforceIf(after)
                # Si la OT y la tarea ajena están activas, debe ir antes o después del bloque OT.
                model.AddBoolOr(
                    [before, after, wo_active.Not(), foreign.presence.Not()],
                )


def _add_work_order_no_interleave_compact(
    model: cp_model.CpModel,
    mv: ModelVars,
    by_wo: dict[str, list[EngineTask]],
) -> None:
    """
    Compact mode hook behind feature flag.

    Keeps exact semantics by reusing legacy implementation until the compact
    formulation is fully validated in canary.
    """
    _add_work_order_no_interleave(model, mv, by_wo)


def _add_max_one_worker_per_task(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    """At most one worker may be assigned to each task."""
    for task in data.tasks:
        blocks = mv.by_task.get(task.id, [])
        if len(blocks) > 1:
            model.Add(sum(bv.presence for bv in blocks) <= 1)


def _add_lamp_ordering(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    for edge in data.lamp_edges:
        pred_demand = data.demand_q.get(edge.predecessor_id, 0)
        if pred_demand <= 0:
            continue

        pred_blocks = mv.by_task.get(edge.predecessor_id, [])
        succ_blocks = mv.by_task.get(edge.successor_id, [])
        if not pred_blocks or not succ_blocks:
            continue

        pred_done = model.NewBoolVar(f"done_{edge.predecessor_id}")
        total_pred = model.NewIntVar(0, pred_demand, f"tp_{edge.predecessor_id}")
        model.Add(total_pred == sum(bv.assigned_q for bv in pred_blocks))
        model.Add(total_pred == pred_demand).OnlyEnforceIf(pred_done)
        model.Add(total_pred < pred_demand).OnlyEnforceIf(pred_done.Not())

        pred_end_terms: list = []
        for bv in pred_blocks:
            contrib = model.NewIntVar(0, HORIZON_Q + 1, f"pec_{_block_tag(bv)}")
            model.Add(contrib == bv.end_wq).OnlyEnforceIf(bv.presence)
            model.Add(contrib == 0).OnlyEnforceIf(bv.presence.Not())
            pred_end_terms.append(contrib)

        pred_end = model.NewIntVar(0, HORIZON_Q + 1, f"pend_{edge.predecessor_id}")
        if pred_end_terms:
            model.AddMaxEquality(pred_end, pred_end_terms)
        else:
            model.Add(pred_end == 0)

        earliest = model.NewIntVar(0, HORIZON_Q + 1, f"early_{edge.successor_id}")
        model.Add(earliest == pred_end + edge.dry_quarters).OnlyEnforceIf(pred_done)
        model.Add(earliest == HORIZON_Q + 1).OnlyEnforceIf(pred_done.Not())

        for bv in succ_blocks:
            model.Add(bv.start_wq >= earliest).OnlyEnforceIf(bv.presence)
            model.Add(bv.presence == 0).OnlyEnforceIf(pred_done.Not())


def _inject_busy_slots(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    for idx, busy in enumerate(data.busy_slots):
        day_idx = (busy.date - data.week_start).days
        if day_idx < 0 or day_idx >= len(data.days):
            continue
        week_tl = data.week_timelines.get(busy.personId)
        if week_tl is None or week_tl.cap <= 0:
            continue
        start_idx = week_tl.find_start_index(day_idx, busy.startSlot, busy.hours)
        if start_idx is None:
            continue
        size_q = round(busy.hours * QUARTERS_PER_HOUR)
        start_wq = week_tl.start_wqs[start_idx]
        end_wq = week_tl.end_exclusive[start_idx][size_q]
        duration = end_wq - start_wq
        busy_iv = model.NewFixedSizeIntervalVar(
            start_wq, duration, f"busy_{busy.personId}_{day_idx}_{idx}"
        )
        mv.worker_ivs.setdefault(busy.personId, []).append(busy_iv)


def _apply_fixed_assignments(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    block_by_task_person = {
        (bv.block.task_id, bv.block.person_id): bv for bv in mv.all_blocks
    }
    for fixed in data.fixed_assignments:
        day_idx = (fixed.date - data.week_start).days
        if day_idx < 0 or day_idx >= len(data.days):
            continue
        bv = block_by_task_person.get((fixed.taskId, fixed.personId))
        if bv is None:
            continue
        week_tl = bv.block.week_tl
        start_idx = week_tl.find_start_index(day_idx, fixed.startSlot, fixed.hours)
        if start_idx is None:
            continue
        size_q = round(fixed.hours * QUARTERS_PER_HOUR)
        model.Add(bv.presence == 1)
        model.Add(bv.start_idx == start_idx)
        model.Add(bv.assigned_q == size_q)


def _scale(v: float) -> int:
    return max(0, int(v * _SCALE))


def _person_by_id(people: list[EnginePerson]) -> dict[str, EnginePerson]:
    return {p.id: p for p in people}


def _build_objective(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    unscheduled: dict[str, cp_model.IntVar],
) -> None:
    w = data.weights
    terms: list = []

    w0 = _scale(w.coverage)
    if w0 > 0:
        terms.append(TIER_COVERAGE * w0 * sum(unscheduled.values()))

    w1 = _scale(w.deadline)
    if w1 > 0:
        _add_deadline_terms(model, data, mv, w1, terms)

    _add_primary_preference_terms(model, data, mv, terms)

    w_labor = _scale(w.labor_cost)
    if w_labor > 0:
        _add_labor_terms(model, data, mv, w_labor, terms)

    w_stab = _scale(w.stability)
    if w_stab > 0:
        _add_stability_terms(model, data, mv, w_stab, terms)

    w_bal = _scale(w.load_balance)
    if w_bal > 0:
        _add_balance_terms(model, data, mv, w_bal, terms)

    w_split = _scale(w.split_penalty)
    if w_split > 0:
        _add_split_terms(model, data, mv, w_split, terms)

    w_prio = _scale(w.project_priority)
    if w_prio > 0:
        _add_project_priority_terms(model, data, mv, w_prio, terms)

    w_es = _scale(w.early_start)
    if w_es > 0:
        _add_early_start_terms(model, data, mv, w_es, terms)

    if terms:
        model.Minimize(sum(terms))


def _add_deadline_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    by_lamp: dict[str, list[EngineTask]] = defaultdict(list)
    for t in data.tasks:
        by_lamp[t.lampId].append(t)

    for lamp_id, lamp_tasks in by_lamp.items():
        end_vars: list = []
        for t in lamp_tasks:
            for bv in mv.by_task.get(t.id, []):
                end_fv = model.NewIntVar(0, HORIZON_Q + 1, f"le_{lamp_id}_{_block_tag(bv)}")
                model.Add(end_fv == bv.end_wq).OnlyEnforceIf(bv.presence)
                model.Add(end_fv == 0).OnlyEnforceIf(bv.presence.Not())
                end_vars.append(end_fv)
        if not end_vars:
            continue

        lamp_end = model.NewIntVar(0, HORIZON_Q + 1, f"lend_{lamp_id}")
        model.AddMaxEquality(lamp_end, end_vars)

        sample = lamp_tasks[0]
        delivery = (
            sample.projectDeliveryDate.date()
            if sample.projectDeliveryDate is not None
            else None
        )
        target_q = _delivery_target_q(delivery, data.week_start)
        if target_q is None:
            continue

        late_q = model.NewIntVar(0, HORIZON_Q + 1, f"late_{lamp_id}")
        model.Add(late_q >= lamp_end - target_q)
        model.Add(late_q >= 0)

        urgency_w = max(
            1,
            int(data.weights.urgency_scale * _urgency(sample, data.week_start)),
        )
        deadline_mult = 1
        if delivery is not None and delivery <= data.week_start:
            deadline_mult = max(
                2,
                int(round(max(1.0, sample.overduePenaltyMultiplier) * 2)),
            )

        coef = TIER_DEADLINE * w * urgency_w * deadline_mult
        terms.append(coef * late_q)

        late_q_sq = model.NewIntVar(
            0, (HORIZON_Q + 1) * (HORIZON_Q + 1), f"late2_{lamp_id}"
        )
        model.AddMultiplicationEquality(late_q_sq, [late_q, late_q])
        terms.append(TIER_DEADLINE * max(1, w // 8) * deadline_mult * late_q_sq)

        if delivery is not None:
            days_left = (delivery - data.week_start).days
            if 0 <= days_left < HORIZON_DAYS:
                terms.append(TIER_DEADLINE * (w // 2) * lamp_end)


def _add_primary_preference_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    terms: list,
) -> None:
    person_by_id = _person_by_id(data.people)
    fallback_quarter_penalty = _scale(1.0)

    for bv in mv.all_blocks:
        person = person_by_id.get(bv.block.person_id)
        if person is None:
            continue
        if bv.block.process in person.primary:
            continue
        if bv.block.process in person.fallback:
            terms.append(TIER_DEADLINE * fallback_quarter_penalty * bv.assigned_q)


def _add_labor_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    for person in data.people:
        rate_reg = int(person.hourlyRate * 100)
        rate_ot = int(person.overtimeHourlyRate * 100)
        for day_idx in range(HORIZON_DAYS):
            day_loads = mv.load_by_person_day.get((person.id, day_idx), [])
            if not day_loads:
                continue
            tl = data.timelines[(person.id, day_idx)]
            total = model.NewIntVar(0, tl.cap, f"dt_{person.id}_{day_idx}")
            model.Add(total == sum(day_loads))
            contract_q = tl.contract_q if tl.contract_q > 0 else tl.cap
            reg = model.NewIntVar(0, tl.cap, f"reg_{person.id}_{day_idx}")
            ot = model.NewIntVar(0, tl.cap, f"ot_{person.id}_{day_idx}")
            model.Add(reg + ot == total)
            model.Add(reg <= contract_q)
            terms.append(TIER_COST * w * rate_reg * reg)
            terms.append(TIER_COST * w * rate_ot * ot)


def _add_stability_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    for bv in mv.all_blocks:
        for day_idx, dv in bv.day_load.items():
            key = f"{bv.block.task_id}|{bv.block.person_id}|{day_idx}"
            prev = data.prev_q.get(key, 0)
            if prev <= 0:
                continue
            diff = model.NewIntVar(0, bv.block.week_tl.cap, f"stab_{_block_tag(bv)}_{day_idx}")
            model.Add(diff >= dv - prev)
            model.Add(diff >= prev - dv)
            terms.append(TIER_COST * w * diff)


def _add_balance_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    max_week_load = HORIZON_DAYS * 32
    person_totals: list[cp_model.IntVar] = []
    for person in data.people:
        blocks = [bv for bv in mv.all_blocks if bv.block.person_id == person.id]
        if not blocks:
            continue
        pt = model.NewIntVar(0, max_week_load, f"load_{person.id}")
        model.Add(pt == sum(bv.assigned_q for bv in blocks))
        person_totals.append(pt)

    if len(person_totals) < 2:
        return

    max_h = model.NewIntVar(0, max_week_load, "maxH")
    min_h = model.NewIntVar(0, max_week_load, "minH")
    model.AddMaxEquality(max_h, person_totals)
    model.AddMinEquality(min_h, person_totals)
    span = model.NewIntVar(0, max_week_load, "spanH")
    model.Add(span == max_h - min_h)
    terms.append(TIER_COST * w * span)


def _add_split_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    for task in data.tasks:
        # canFragment=false already caps active blocks to one via hard constraint.
        if not task.canFragment:
            continue
        blocks = mv.by_task.get(task.id, [])
        if len(blocks) < 2:
            continue
        active = [bv.presence for bv in blocks]
        n_active = model.NewIntVar(0, len(blocks), f"nb_{task.id}")
        model.Add(n_active == sum(active))
        extra = model.NewIntVar(0, len(blocks) - 1, f"xtra_{task.id}")
        model.Add(extra >= n_active - 1)
        model.Add(extra >= 0)
        terms.append(TIER_COST * w * extra)


def _delivery_urgency_score(task: EngineTask, week_start: date) -> int:
    if task.projectDeliveryDate is None:
        return 0
    days_left = (task.projectDeliveryDate.date() - week_start).days
    curve = max(1.0, float(task.deadlineCurveExponent))
    overdue_mult = max(1.0, float(task.overduePenaltyMultiplier))
    priority_factor = 0.5 + (max(0, min(100, task.projectPriority)) / 100.0) * 1.5

    if days_left >= 0:
        near = max(0.0, (30.0 - days_left) / 30.0)
        pressure = near**curve
    else:
        overdue_days = abs(days_left)
        pressure = ((1.0 + overdue_days / 7.0) ** curve) * overdue_mult

    return int(min(400, round(pressure * priority_factor * 100)))


def _add_project_priority_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    for task in data.tasks:
        score = _delivery_urgency_score(task, data.week_start)
        if score <= 0:
            continue
        for bv in mv.by_task.get(task.id, []):
            terms.append(-TIER_DEADLINE * w * score * bv.assigned_q)


def _add_early_start_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    horizon = HORIZON_Q + 1
    for task in data.tasks:
        blocks = mv.by_task.get(task.id, [])
        if not blocks:
            continue

        min_vars: list = []
        max_vars: list = []
        for bv in blocks:
            start_fv = model.NewIntVar(0, horizon, f"esfs_{_block_tag(bv)}")
            model.Add(start_fv == bv.start_wq).OnlyEnforceIf(bv.presence)
            model.Add(start_fv == horizon).OnlyEnforceIf(bv.presence.Not())
            min_vars.append(start_fv)

            end_fv = model.NewIntVar(0, horizon, f"esfe_{_block_tag(bv)}")
            model.Add(end_fv == bv.end_wq).OnlyEnforceIf(bv.presence)
            model.Add(end_fv == 0).OnlyEnforceIf(bv.presence.Not())
            max_vars.append(end_fv)

        first_start = model.NewIntVar(0, horizon, f"es_first_{task.id}")
        model.AddMinEquality(first_start, min_vars)
        last_end = model.NewIntVar(0, horizon, f"es_last_{task.id}")
        model.AddMaxEquality(last_end, max_vars)

        n_active = model.NewIntVar(0, len(blocks), f"esan_{task.id}")
        model.Add(n_active == sum(bv.presence for bv in blocks))
        active = model.NewBoolVar(f"esact_{task.id}")
        model.Add(n_active >= 1).OnlyEnforceIf(active)
        model.Add(n_active == 0).OnlyEnforceIf(active.Not())

        eff_start = model.NewIntVar(0, horizon, f"eseff_{task.id}")
        model.Add(eff_start == first_start).OnlyEnforceIf(active)
        model.Add(eff_start == 0).OnlyEnforceIf(active.Not())
        eff_end = model.NewIntVar(0, horizon, f"efe_{task.id}")
        model.Add(eff_end == last_end).OnlyEnforceIf(active)
        model.Add(eff_end == 0).OnlyEnforceIf(active.Not())
        terms.append(TIER_COST * w * eff_start)
        terms.append(TIER_COST * w * eff_end)


def _fixed_to_engine_assignments(
    fixed_list: list[FixedAssignment],
) -> list[EngineAssignment]:
    from app.model.timeline import AFTERNOON_UI_OFFSET

    return [
        EngineAssignment(
            taskId=f.taskId,
            personId=f.personId,
            date=f.date,
            startSlot=f.startSlot,
            endSlot=f.endSlot,
            hours=f.hours,
            process=f.process,
            isAfternoon=f.startSlot >= AFTERNOON_UI_OFFSET,
        )
        for f in fixed_list
    ]


def _extract_solution(
    mv: ModelVars,
    unscheduled: dict[str, cp_model.IntVar],
    solver: cp_model.CpSolver,
    fixed_list: list[FixedAssignment],
    data: ProblemData,
) -> SolveResponse:
    assignments: list[EngineAssignment] = []

    for bv in mv.all_blocks:
        if not solver.Value(bv.presence):
            continue
        assigned_q = solver.Value(bv.assigned_q)
        if assigned_q <= 0:
            continue
        start_idx = solver.Value(bv.start_idx)
        slices = bv.block.week_tl.to_daily_slices(start_idx, assigned_q)
        group = data.wo_collapse.get(bv.block.task_id)
        if group is not None:
            assignments.extend(
                expand_collapsed_assignments(group, slices, bv.block.person_id)
            )
            continue
        for sl in slices:
            assignments.append(
                EngineAssignment(
                    taskId=bv.block.task_id,
                    personId=bv.block.person_id,
                    date=sl.day,
                    startSlot=sl.start_slot,
                    endSlot=sl.end_slot,
                    hours=sl.hours,
                    process=bv.block.process,
                    isAfternoon=sl.is_afternoon,
                )
            )

    warnings: list[EngineWarning] = []
    total_unscheduled_q = 0
    for task_id, u_var in unscheduled.items():
        uq = solver.Value(u_var)
        if uq <= 0:
            continue
        total_unscheduled_q += uq
        group = data.wo_collapse.get(task_id)
        if group is not None:
            for member_id, hours in expand_unscheduled_warning(
                group, uq / QUARTERS_PER_HOUR
            ):
                warnings.append(
                    EngineWarning(
                        taskId=member_id,
                        reason=f"Quedan {hours:.2f}h sin asignar",
                    )
                )
            continue
        warnings.append(
            EngineWarning(
                taskId=task_id,
                reason=f"Quedan {uq / QUARTERS_PER_HOUR:.2f}h sin asignar",
            )
        )

    seen = {(a.taskId, a.personId, a.date, a.startSlot) for a in assignments}
    for fixed in fixed_list:
        key = (fixed.taskId, fixed.personId, fixed.date, fixed.startSlot)
        if key in seen:
            continue
        seen.add(key)
        assignments.extend(_fixed_to_engine_assignments([fixed]))

    return SolveResponse(
        assignments=assignments,
        warnings=warnings,
        unscheduledHours=total_unscheduled_q / QUARTERS_PER_HOUR,
    )


class _EarlyStopCallback(cp_model.CpSolverSolutionCallback):
    """Stop the solver once coverage is full and the gap is tight enough."""

    def __init__(
        self,
        unscheduled_vars: list[cp_model.IntVar],
        gap_threshold: float,
    ) -> None:
        super().__init__()
        self._unscheduled = unscheduled_vars
        self._gap = gap_threshold

    def on_solution_callback(self) -> None:
        total_unsched = sum(self.Value(v) for v in self._unscheduled)
        if total_unsched > 0:
            return
        best = self.ObjectiveValue()
        bound = self.BestObjectiveBound()
        if best == 0 or abs(best - bound) / max(1, abs(best)) <= self._gap:
            self.StopSearch()


def _dynamic_max_seconds(
    base: int,
    task_count: int,
    block_count: int,
) -> int:
    """Scale solver budget down for small problems."""
    if task_count <= 5 and block_count <= 20:
        return min(base, 15)
    if task_count <= 15 and block_count <= 80:
        return min(base, 45)
    if task_count <= 30 and block_count <= 200:
        return min(base, 90)
    return base


def _dynamic_gap_limit(task_count: int, block_count: int) -> float:
    """Loosen the gap tolerance for small problems to exit faster."""
    if task_count <= 10 and block_count <= 50:
        return 0.02
    if task_count <= 30 and block_count <= 200:
        return 0.01
    return 0.0


def _infeasible_response(
    tasks: list[EngineTask],
    status: int,
    solver: cp_model.CpSolver,
    max_solve_seconds: int,
    wo_collapse: dict[str, WoCollapseGroup] | None = None,
) -> SolveResponse:
    status_name = solver.StatusName(status)
    logger.warning("solver status=%s tasks=%d", status_name, len(tasks))
    if status == cp_model.INFEASIBLE:
        reason = (
            "No hay solución factible con las restricciones actuales "
            "(capacidad, especialidad o precedencia)."
        )
    else:
        reason = (
            f"El optimizador no encontró solución a tiempo "
            f"(presupuesto {max_solve_seconds}s, estado {status_name}). "
            "Regenera el planning o aumenta SOLVER_MAX_SECONDS."
        )
    first_task_id = display_task_id(
        tasks[0].id,
        wo_collapse or {},
    )
    return SolveResponse(
        assignments=[],
        warnings=[EngineWarning(taskId=first_task_id, reason=reason)],
        unscheduledHours=sum(t.pendingHours for t in tasks),
    )


class _UnionFind:
    """Lightweight disjoint-set for partitioning tasks and workers."""

    def __init__(self) -> None:
        self._parent: dict[str, str] = {}
        self._rank: dict[str, int] = {}

    def _ensure(self, x: str) -> None:
        if x not in self._parent:
            self._parent[x] = x
            self._rank[x] = 0

    def find(self, x: str) -> str:
        self._ensure(x)
        root = x
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[x] != root:
            self._parent[x], x = root, self._parent[x]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self._rank[ra] < self._rank[rb]:
            ra, rb = rb, ra
        self._parent[rb] = ra
        if self._rank[ra] == self._rank[rb]:
            self._rank[ra] += 1

    def components(self) -> dict[str, set[str]]:
        groups: dict[str, set[str]] = defaultdict(set)
        for x in self._parent:
            groups[self.find(x)].add(x)
        return dict(groups)


def _partition_components(
    data: ProblemData,
) -> list[set[str]] | None:
    """Find independent task groups that share no workers, chains, or OT links.

    Returns None when everything is connected (single component) or partitioning
    would not help (<=1 component).
    """
    if len(data.tasks) <= 1:
        return None

    uf = _UnionFind()
    task_ids = {t.id for t in data.tasks}
    for t in data.tasks:
        uf.find(t.id)

    # Link tasks sharing a candidate worker
    worker_first_task: dict[str, str] = {}
    for t in data.tasks:
        for person in _task_candidates(data, t):
            prev = worker_first_task.get(person.id)
            if prev is not None:
                uf.union(prev, t.id)
            else:
                worker_first_task[person.id] = t.id

    # Link lamp/element chains
    for edge in data.lamp_edges:
        if edge.predecessor_id in task_ids and edge.successor_id in task_ids:
            uf.union(edge.predecessor_id, edge.successor_id)

    # Link work order task groups
    wo_tasks: dict[str, list[str]] = defaultdict(list)
    for t in data.tasks:
        if t.workOrderId:
            wo_tasks[t.workOrderId].append(t.id)
    for members in wo_tasks.values():
        for tid in members[1:]:
            uf.union(members[0], tid)

    # Link work order pipelines (by actual task IDs belonging to each WO)
    tasks_by_wo: dict[str, list[str]] = defaultdict(list)
    for t in data.tasks:
        wo_id = t.workOrderId
        if wo_id:
            tasks_by_wo[wo_id].append(t.id)
        group = data.wo_collapse.get(t.id)
        if group:
            tasks_by_wo[group.work_order_id].append(t.id)
    for edge in data.work_order_pipelines:
        pred_tasks = tasks_by_wo.get(edge.predecessorWorkOrderId, [])
        succ_tasks = tasks_by_wo.get(edge.successorWorkOrderId, [])
        if pred_tasks and succ_tasks:
            uf.union(pred_tasks[0], succ_tasks[0])

    components = uf.components()
    task_components = [ids & task_ids for ids in components.values() if ids & task_ids]
    if len(task_components) <= 1:
        return None
    return task_components


def _build_component_data(
    data: ProblemData,
    component_task_ids: set[str],
) -> ProblemData:
    """Build a sub-ProblemData for one partition component."""
    task_set = component_task_ids
    tasks = [t for t in data.tasks if t.id in task_set]

    person_ids: set[str] = set()
    for t in tasks:
        for person in _task_candidates(data, t):
            person_ids.add(person.id)
    people = [p for p in data.people if p.id in person_ids]

    lamp_edges = [
        e for e in data.lamp_edges
        if e.predecessor_id in task_set or e.successor_id in task_set
    ]
    fixed_assignments = [
        f for f in data.fixed_assignments if f.taskId in task_set
    ]
    busy_slots = [
        b for b in data.busy_slots if b.personId in person_ids
    ]
    prev_q = {
        k: v for k, v in data.prev_q.items()
        if k.split("|", 1)[0] in task_set
    }

    wo_ids = {t.workOrderId for t in tasks if t.workOrderId}
    pipelines = [
        e for e in data.work_order_pipelines
        if (
            e.predecessorWorkOrderId in wo_ids
            or e.successorWorkOrderId in wo_ids
        )
    ]

    placement_catalogs = {
        pid: cat for pid, cat in data.placement_catalogs.items()
        if pid in person_ids
    }
    candidate_ids_by_task = {
        tid: ids for tid, ids in data.candidate_ids_by_task.items()
        if tid in task_set
    }
    candidate_ids_by_process_nave = data.candidate_ids_by_process_nave
    wo_collapse = {
        k: v for k, v in data.wo_collapse.items() if k in task_set
    }
    people_by_id = {
        pid: p for pid, p in data.people_by_id.items()
        if pid in person_ids
    }

    return ProblemData(
        tasks=tasks,
        demand_q={t.id: data.demand_q[t.id] for t in tasks},
        days=data.days,
        week_start=data.week_start,
        timelines={
            k: v for k, v in data.timelines.items() if k[0] in person_ids
        },
        week_timelines={
            k: v for k, v in data.week_timelines.items() if k in person_ids
        },
        process_by_code=data.process_by_code,
        prev_q=prev_q,
        people=people,
        lamp_edges=lamp_edges,
        weights=data.weights,
        fixed_assignments=fixed_assignments,
        busy_slots=busy_slots,
        placement_catalogs=placement_catalogs,
        wo_collapse=wo_collapse,
        candidate_ids_by_task=candidate_ids_by_task,
        work_order_pipelines=pipelines,
        candidate_ids_by_process_nave=candidate_ids_by_process_nave,
        people_by_id=people_by_id,
    )


def _solve_single(
    data: ProblemData,
    config: SchedulerConfig,
    prepare_ms: int,
) -> SolveResponse:
    """Build model and solve for one (possibly partitioned) ProblemData."""
    model = cp_model.CpModel()
    model_started = time.perf_counter()
    mv, placement_rows_total = _build_block_variables(model, data)
    model_build_ms = int((time.perf_counter() - model_started) * 1000)
    block_count = len(mv.all_blocks)

    unplannable = _find_unplannable_warnings(data, mv)
    if unplannable:
        total_q = sum(data.demand_q.get(t.id, 0) for t in data.tasks)
        return SolveResponse(
            assignments=[],
            warnings=unplannable,
            unscheduledHours=total_q / QUARTERS_PER_HOUR,
        )

    _inject_busy_slots(model, data, mv)
    unscheduled = _add_constraints(model, data, mv)
    _apply_fixed_assignments(model, data, mv)
    _build_objective(model, data, mv, unscheduled)

    solver = cp_model.CpSolver()
    effective_max = _dynamic_max_seconds(
        config.max_solve_seconds, len(data.tasks), block_count,
    )
    solver.parameters.max_time_in_seconds = effective_max
    num_workers = int(os.environ.get("SOLVER_NUM_WORKERS", "4"))
    solver.parameters.num_search_workers = max(0, num_workers)
    gap = config.relative_gap_limit or _dynamic_gap_limit(
        len(data.tasks), block_count,
    )
    if gap > 0:
        solver.parameters.relative_gap_limit = gap
    early_cb = _EarlyStopCallback(
        list(unscheduled.values()), config.early_stop_gap,
    )

    solve_started_cp = time.perf_counter()
    status = solver.Solve(model, early_cb)
    solve_ms = int((time.perf_counter() - solve_started_cp) * 1000)
    status_name = solver.StatusName(status)

    logger.info(
        "solver metrics: taskCount=%d blockCount=%d placementRows=%d woCollapsed=%d "
        "prepareMs=%d modelBuildMs=%d solveMs=%d status=%s",
        len(data.tasks),
        block_count,
        placement_rows_total,
        len(data.wo_collapse),
        prepare_ms,
        model_build_ms,
        solve_ms,
        status_name,
    )

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _infeasible_response(
            data.tasks, status, solver, config.max_solve_seconds, data.wo_collapse
        )

    return _extract_solution(
        mv, unscheduled, solver, data.fixed_assignments, data
    )


def solve_week(
    request: SolveRequest,
    config: SchedulerConfig | None = None,
) -> SolveResponse:
    if config is None:
        config = SchedulerConfig()

    solve_started = time.perf_counter()
    prepare_started = time.perf_counter()
    data = _prepare(request, config)
    prepare_ms = int((time.perf_counter() - prepare_started) * 1000)
    if data is None:
        return SolveResponse(assignments=[], warnings=[], unscheduledHours=0.0)

    if not data.tasks:
        return SolveResponse(
            assignments=_fixed_to_engine_assignments(request.fixedAssignments),
            warnings=[],
            unscheduledHours=0.0,
        )

    candidate_pairs = sum(len(_task_candidates(data, task)) for task in data.tasks)
    no_interleave_mode = _no_interleave_mode()

    components = _partition_components(data)
    partition_count = len(components) if components else 1

    logger.info(
        "solver input metrics: tasks=%d people=%d candidatePairs=%d fixed=%d "
        "busy=%d previous=%d components=%d noInterleave=%s",
        len(data.tasks),
        len(data.people),
        candidate_pairs,
        len(data.fixed_assignments),
        len(data.busy_slots),
        len(data.prev_q),
        partition_count,
        no_interleave_mode,
    )

    if components and len(components) > 1:
        logger.info(
            "solving %d independent components: sizes=%s",
            len(components),
            [len(c) for c in components],
        )
        all_assignments: list[EngineAssignment] = []
        all_warnings: list[EngineWarning] = []
        total_unscheduled = 0.0

        for idx, comp_task_ids in enumerate(components):
            comp_data = _build_component_data(data, comp_task_ids)
            comp_response = _solve_single(comp_data, config, prepare_ms)
            logger.info(
                "component %d/%d solved: tasks=%d assignments=%d unscheduled=%.2f",
                idx + 1,
                len(components),
                len(comp_task_ids),
                len(comp_response.assignments),
                comp_response.unscheduledHours,
            )
            all_assignments.extend(comp_response.assignments)
            all_warnings.extend(comp_response.warnings)
            total_unscheduled += comp_response.unscheduledHours

        total_ms = int((time.perf_counter() - solve_started) * 1000)
        logger.info(
            "partitioned solve done: components=%d totalMs=%d assignments=%d unscheduled=%.2f",
            len(components),
            total_ms,
            len(all_assignments),
            total_unscheduled,
        )
        return SolveResponse(
            assignments=all_assignments,
            warnings=all_warnings,
            unscheduledHours=total_unscheduled,
        )

    response = _solve_single(data, config, prepare_ms)
    total_ms = int((time.perf_counter() - solve_started) * 1000)
    logger.info("monolithic solve done: totalMs=%d", total_ms)

    if response.unscheduledHours > 0:
        logger.info(
            "solve diagnostics: assignments=%d unscheduledHours=%.2f",
            len(response.assignments),
            response.unscheduledHours,
        )
    return response
