"""
Block-based CP-SAT weekly scheduler.

One optional contiguous work block per (task, worker) candidate. Start index and
assigned duration are decision variables; end time is derived from a precomputed
worker-week calendar table. Worker continuity is structural via global NoOverlap.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import NamedTuple

from ortools.sat.python import cp_model

from app.model.candidates import pick_candidates
from app.model.timeline import (
    QUARTERS_PER_HOUR,
    WorkerDayTimeline,
    WorkerWeekTimeline,
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
)

logger = logging.getLogger("planning-solver")

NO_CANDIDATE_PREFIX = "NO_CANDIDATE:"

HORIZON_DAYS: int = 5
QUARTERS_PER_DAY = 24 * 4
HORIZON_Q: int = HORIZON_DAYS * QUARTERS_PER_DAY

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
    max_solve_seconds: int = 60
    weights: SchedulerWeights = field(default_factory=SchedulerWeights)


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
    lamp_iv: cp_model.IntervalVar
    day_load: dict[int, cp_model.IntVar]


@dataclass
class ModelVars:
    all_blocks: list[BlockVars] = field(default_factory=list)
    by_task: dict[str, list[BlockVars]] = field(default_factory=dict)
    worker_ivs: dict[str, list[cp_model.IntervalVar]] = field(default_factory=dict)
    lamp_ivs: dict[str, list[cp_model.IntervalVar]] = field(default_factory=dict)
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


def _build_lamp_edges(
    tasks: list[EngineTask],
    process_by_code: dict,
) -> list[LampEdge]:
    by_lamp: dict[str, list[EngineTask]] = defaultdict(list)
    for t in tasks:
        by_lamp[t.lampId].append(t)

    edges: list[LampEdge] = []
    for group in by_lamp.values():
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

    timelines: dict[tuple[str, int], WorkerDayTimeline] = {}
    week_timelines: dict[str, WorkerWeekTimeline] = {}

    for person in request.people:
        s = sched_by_person.get(person.id)
        weekly = s.weekly if s else []
        overrides = s.overrides if s else []
        day_tls: list[WorkerDayTimeline] = []
        for day_idx, day in enumerate(days):
            if day_idx < first_day:
                timelines[(person.id, day_idx)] = _empty_timeline(
                    person.id, day, day_idx
                )
                continue

            override = next((o for o in overrides if o.date == day), None)
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
    process_by_code = {p.code: p for p in request.processes}

    return ProblemData(
        tasks=tasks,
        demand_q={t.id: round(t.pendingHours * QUARTERS_PER_HOUR) for t in tasks},
        days=days,
        week_start=week_start,
        timelines=timelines,
        week_timelines=week_timelines,
        process_by_code=process_by_code,
        prev_q={e.key: e.quarters for e in request.previousHours},
        people=request.people,
        lamp_edges=_build_lamp_edges(tasks, process_by_code),
        weights=weights,
        fixed_assignments=list(request.fixedAssignments),
        busy_slots=list(request.busySlots),
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


@dataclass(frozen=True)
class BlockPlacement:
    start_idx: int
    assigned_q: int
    start_wq: int
    end_wq: int
    day_load: tuple[int, ...]


def _feasible_placements(
    week_tl: WorkerWeekTimeline,
    demand_q: int,
    min_week_quarter: int,
    can_fragment: bool,
) -> list[BlockPlacement]:
    """Valid (start, duration) pairs aligned to segment boundaries."""
    placements: list[BlockPlacement] = []
    if week_tl.cap <= 0:
        return placements
    max_d = min(demand_q, week_tl.cap)
    for i in week_tl.segment_start_indices():
        if week_tl.start_wqs[i] < min_week_quarter:
            continue
        for d in range(1, max_d + 1):
            if i + d > week_tl.cap:
                break
            if not can_fragment and not week_tl.same_day_span(i, d):
                continue
            by_day = [0] * HORIZON_DAYS
            for ref in week_tl.quarters[i : i + d]:
                by_day[ref.day_index] += 1
            placements.append(
                BlockPlacement(
                    start_idx=i,
                    assigned_q=d,
                    start_wq=week_tl.start_wqs[i],
                    end_wq=week_tl.end_exclusive[i][d],
                    day_load=tuple(by_day),
                )
            )
    return placements


def _build_block_variables(
    model: cp_model.CpModel,
    data: ProblemData,
) -> ModelVars:
    mv = ModelVars()
    task_by_id = {t.id: t for t in data.tasks}

    for task in data.tasks:
        demand_q = data.demand_q[task.id]
        proc = data.process_by_code.get(task.process)
        if proc is None:
            continue

        for person in pick_candidates(data.people, task.process):
            week_tl = data.week_timelines.get(person.id)
            if week_tl is None or week_tl.cap <= 0:
                continue

            placements = _feasible_placements(
                week_tl,
                demand_q,
                task.minWeekQuarter or 0,
                task.canFragment,
            )
            if not placements:
                continue

            tag = f"{task.id}_{person.id}"
            presence = model.NewBoolVar(f"bp_{tag}")
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

            placement_vars: list[cp_model.BoolVar] = []
            for pidx, pl in enumerate(placements):
                pv = model.NewBoolVar(f"bpl_{tag}_{pidx}")
                placement_vars.append(pv)
                model.Add(start_idx == pl.start_idx).OnlyEnforceIf(pv)
                model.Add(assigned_q == pl.assigned_q).OnlyEnforceIf(pv)
                model.Add(start_wq == pl.start_wq).OnlyEnforceIf(pv)
                model.Add(end_wq == pl.end_wq).OnlyEnforceIf(pv)
                for day_idx in range(HORIZON_DAYS):
                    model.Add(day_load[day_idx] == pl.day_load[day_idx]).OnlyEnforceIf(
                        pv
                    )

            model.Add(sum(placement_vars) == presence)
            model.Add(assigned_q == 0).OnlyEnforceIf(presence.Not())
            model.Add(start_wq == 0).OnlyEnforceIf(presence.Not())
            model.Add(end_wq == 0).OnlyEnforceIf(presence.Not())
            model.Add(duration_wq == end_wq - start_wq).OnlyEnforceIf(presence)
            model.Add(duration_wq == 0).OnlyEnforceIf(presence.Not())

            worker_iv = model.NewOptionalIntervalVar(
                start_wq, duration_wq, end_wq, presence, f"wiv_{tag}"
            )
            lamp_iv = model.NewOptionalIntervalVar(
                start_wq, duration_wq, end_wq, presence, f"liv_{tag}"
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
                lamp_iv=lamp_iv,
                day_load=day_load,
            )
            mv.all_blocks.append(bv)
            mv.by_task.setdefault(task.id, []).append(bv)
            mv.worker_ivs.setdefault(person.id, []).append(worker_iv)
            mv.lamp_ivs.setdefault(task.lampId, []).append(lamp_iv)
            for day_idx, dv in day_load.items():
                mv.load_by_person_day.setdefault((person.id, day_idx), []).append(dv)

    return mv


def _block_debug_rows(data: ProblemData, mv: ModelVars) -> list[dict]:
    rows: list[dict] = []
    for task in data.tasks:
        blocks = mv.by_task.get(task.id, [])
        cand = pick_candidates(data.people, task.process)
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
    candidates = pick_candidates(data.people, task.process)
    if not candidates:
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

    for ivs in mv.lamp_ivs.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    _add_lamp_ordering(model, data, mv)
    _add_max_one_worker_per_task(model, data, mv)

    return unscheduled


def _add_max_one_worker_per_task(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    """When canFragment=false, at most one worker-day block (single calendar day)."""
    for task in data.tasks:
        if task.canFragment:
            continue
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
    for fixed in data.fixed_assignments:
        day_idx = (fixed.date - data.week_start).days
        if day_idx < 0 or day_idx >= len(data.days):
            continue
        bv = next(
            (
                b
                for b in mv.by_task.get(fixed.taskId, [])
                if b.block.person_id == fixed.personId
            ),
            None,
        )
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
        if uq > 0:
            total_unscheduled_q += uq
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


def _infeasible_response(
    tasks: list[EngineTask],
    status: int,
    solver: cp_model.CpSolver,
) -> SolveResponse:
    logger.warning("solver status=%s tasks=%d", solver.StatusName(status), len(tasks))
    if status == cp_model.INFEASIBLE:
        reason = (
            "No hay solución factible con las restricciones actuales "
            "(capacidad, especialidad o precedencia)."
        )
    else:
        reason = "El optimizador no encontró solución a tiempo."
    return SolveResponse(
        assignments=[],
        warnings=[EngineWarning(taskId=tasks[0].id, reason=reason)],
        unscheduledHours=sum(t.pendingHours for t in tasks),
    )


def solve_week(
    request: SolveRequest,
    config: SchedulerConfig | None = None,
) -> SolveResponse:
    if config is None:
        config = SchedulerConfig()

    data = _prepare(request, config)
    if data is None:
        return SolveResponse(assignments=[], warnings=[], unscheduledHours=0.0)

    if not data.tasks:
        return SolveResponse(
            assignments=_fixed_to_engine_assignments(request.fixedAssignments),
            warnings=[],
            unscheduledHours=0.0,
        )

    model = cp_model.CpModel()
    mv = _build_block_variables(model, data)
    task_debug = _block_debug_rows(data, mv)
    logger.info(
        "task blocks: tasks=%d with_blocks=%d without_blocks=%d",
        len(task_debug),
        sum(1 for r in task_debug if r["blockCount"] > 0),
        sum(1 for r in task_debug if r["blockCount"] == 0),
    )
    logger.info("task blocks detail: %s", task_debug)

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
    solver.parameters.max_time_in_seconds = config.max_solve_seconds
    solver.parameters.num_search_workers = 0
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _infeasible_response(data.tasks, status, solver)

    response = _extract_solution(mv, unscheduled, solver, request.fixedAssignments)
    if response.unscheduledHours > 0:
        unscheduled_by_task = {
            task_id: solver.Value(u_var) / QUARTERS_PER_HOUR
            for task_id, u_var in unscheduled.items()
            if solver.Value(u_var) > 0
        }
        logger.info(
            "solve diagnostics: assignments=%d unscheduledHours=%.2f unscheduledTasks=%d",
            len(response.assignments),
            response.unscheduledHours,
            len(unscheduled_by_task),
        )
        logger.info("solve diagnostics unscheduledByTask: %s", unscheduled_by_task)
    return response
