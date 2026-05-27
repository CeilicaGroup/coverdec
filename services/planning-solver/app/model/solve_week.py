"""
CP-SAT weekly scheduler — clean reimplementation.

Key design changes vs. original
────────────────────────────────
1. Domain data (ProblemData) and solver variables (ModelVars) are kept in
   separate dataclasses.  No CP-SAT types leak into domain objects.

2. The objective uses explicit *priority tiers* (powers of 10) instead of
   a single COVERAGE_WEIGHT magic constant, so you can reason about each
   term independently and the relative importance order is enforced by
   construction.

   Tier 0 — Coverage      ×10⁶   (schedule every quarter)
   Tier 1 — Deadlines     ×10³   (finish projects on time)
   Tier 2 — Cost / other  ×1     (labour cost, stability, balance)

3. SchedulerWeights is the single knob the caller turns; it contains one
   float per objective dimension.  Weights multiply within their tier, so
   you can blend deadline vs. urgency without disturbing coverage.

4. A future `project_priority` weight is wired in as Tier-1 bonus so it
   integrates naturally once that feature is added.

5. Lamp-chain ordering logic lives in its own function with clear
   documentation of what it enforces.
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
    QUARTERS_PER_DAY,
    QUARTERS_PER_HOUR,
    WorkerDayTimeline,
    _build_expanded,
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

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

HORIZON_DAYS: int = 5
HORIZON_Q: int = HORIZON_DAYS * QUARTERS_PER_DAY  # total quarters in week

# Objective tier multipliers — each tier dominates all lower ones.
# Max quarters in a week ≈ 5×32 = 160; tasks ≈ hundreds → max tier-2 term < 10⁶.
TIER_COVERAGE: int = 10**6  # Tier 0: schedule every pending quarter
TIER_DEADLINE: int = 10**3  # Tier 1: meet deadlines / urgency
TIER_COST: int = 1  # Tier 2: cost, balance, stability

# Fixed-point scale for float weights (keeps CP-SAT integers small)
_SCALE: int = 1_000


# ──────────────────────────────────────────────────────────────────────────────
# Public API types
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class SchedulerWeights:
    """
    All objective knobs in one place.

    Each weight is a non-negative float.  Setting a weight to 0 disables
    that objective term entirely.

    Tiers are enforced by the solver; you only need to tune within a tier.

    Tier 0 — Coverage (always on)
    ─────────────────────────────
    coverage        weight on unscheduled quarters (default 1.0)

    Tier 1 — Deadline pressure
    ──────────────────────────
    deadline        penalty per quarter a lamp finishes after its delivery date
    urgency_scale   multiplies deadline penalty for projects due within 14 days

    Tier 2 — Cost and quality
    ─────────────────────────
    labor_cost      weight on worker hourly cost (regular + overtime)
    load_balance    weight on (max_load − min_load) across workers
    stability       weight on |new_assignment − previous_assignment| per slot
    split_penalty   weight on the number of extra blocks used per task
                    (e.g. a task scheduled across 3 slots pays 2 × weight).
                    Pushes the solver to consolidate work into fewer, longer
                    blocks rather than scattering 15-min slivers across days.
    early_start     weight on how early each task starts on the absolute week
                    timeline (week_quarter_start). One term per task, not per slot.
    gap_penalty     weight on the day-span of each (task, worker) assignment:
                    span = last_active_day_index − first_active_day_index.
                    Correctly penalises non-adjacent splits (Mon+Thu → span=3)
                    more than adjacent ones (Mon+Tue → span=1), unlike a
                    pair-wise approach that gives 0 for non-adjacent pairs.
                    At default 10.0 (10,000 units/day), a 1-day span costs
                    10,000, which is lower than the early_start saving of a
                    1-day earlier first start (~20,400 units), so
                    afternoon→next-morning splits win over next-day-only.
    # project_priority  (future) weight on priority-score bonus per scheduled quarter
    """

    # Tier 0
    coverage: float = 1.0

    # Tier 1
    deadline: float = 1.0
    urgency_scale: float = 1.0  # deadline multiplier for urgent projects

    # Tier 2
    labor_cost: float = 1.0
    load_balance: float = 1.0
    stability: float = 0.5
    split_penalty: float = 1.0
    early_start: float = 0.3
    gap_penalty: float = 10.0   # weight on inter-fragment day-gaps per (task, worker)

    # Future (set to 0 until project-priority scores are available)
    project_priority: float = 0.0


@dataclass(frozen=True)
class SchedulerConfig:
    horizon_days: int = HORIZON_DAYS
    max_solve_seconds: int = 60
    weights: SchedulerWeights = field(default_factory=SchedulerWeights)


# ──────────────────────────────────────────────────────────────────────────────
# Internal domain types  (no CP-SAT types here)
# ──────────────────────────────────────────────────────────────────────────────


class LampEdge(NamedTuple):
    """Ordering constraint between two consecutive tasks on the same lamp."""

    predecessor_id: str
    successor_id: str
    dry_quarters: int  # minimum gap between end of predecessor and start of successor


@dataclass
class TaskSlot:
    """Pure domain info for one (task × worker × day) candidate slot."""

    task_id: str
    person_id: str
    lamp_id: str
    day: date
    day_index: int
    process: str
    timeline: WorkerDayTimeline
    demand_q: int  # total pending quarters for this task
    urgency: int  # 1/2/4 based on delivery date proximity


# ──────────────────────────────────────────────────────────────────────────────
# Internal solver types  (CP-SAT variables, one per TaskSlot)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class SlotVars:
    """CP-SAT variables for one (task × worker × day) slot."""

    slot: TaskSlot
    presence: cp_model.BoolVar  # 1 iff this slot is used
    start: cp_model.IntVar  # local compressed-slot index
    size: cp_model.IntVar  # quarters assigned (0 if absent)
    end: cp_model.IntVar
    worker_iv: cp_model.IntervalVar  # for worker NoOverlap
    lamp_iv: cp_model.IntervalVar  # week-quarter view for lamp NoOverlap
    # Effective size = size if present, else 0 — convenience alias
    effective: cp_model.IntVar


# ──────────────────────────────────────────────────────────────────────────────
# Helper utilities
# ──────────────────────────────────────────────────────────────────────────────


def _add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def _iso_weekday(d: date) -> int:
    """Monday = 1 … Sunday = 7 (matches schedule deadlineDay convention)."""
    return d.isoweekday()


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
    """
    Return the week-quarter index (exclusive end) that represents the end of
    the project delivery day.  Returns None when no delivery date is set.
    Clamps to the last day of the scheduling horizon.
    """
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
    """
    For each lamp, sort tasks by their declared order (set from FrameTypeProcess.sequence
    at lamp creation) and emit one LampEdge per consecutive pair.
    The edge carries the dry-time gap in quarters.
    """
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


# ──────────────────────────────────────────────────────────────────────────────
# Week-quarter projection helpers
# ──────────────────────────────────────────────────────────────────────────────


def _wq_start(
    model: cp_model.CpModel,
    sv: SlotVars,
    tag: str,
) -> cp_model.IntVar:
    """Week-quarter index of the slot's start (for ordering constraints)."""
    v = model.NewIntVar(0, HORIZON_Q, f"wqs_{tag}")
    wq = list(sv.slot.timeline.wq_exp)
    if wq:
        model.AddElement(sv.start, wq, v)
    else:
        model.Add(v == 0)
    return v


def _wq_end_exclusive(
    model: cp_model.CpModel,
    sv: SlotVars,
    tag: str,
) -> cp_model.IntVar:
    """Week-quarter index one past the slot's end (for ordering constraints)."""
    v = model.NewIntVar(0, HORIZON_Q + 1, f"wqe_{tag}")
    tl = sv.slot.timeline
    wq = list(tl.wq_exp)
    if not wq:
        model.Add(v == 0)
        return v
    cap_exp = len(wq)
    end_local = model.NewIntVar(0, max(0, cap_exp - 1), f"el_{tag}")
    model.Add(end_local == sv.start + sv.size - 1).OnlyEnforceIf(sv.presence)
    model.Add(end_local == 0).OnlyEnforceIf(sv.presence.Not())
    model.AddElement(end_local, [q + 1 for q in wq], v)
    return v


def _make_lamp_interval(
    model: cp_model.CpModel,
    sv: SlotVars,
    tag: str,
) -> cp_model.IntervalVar:
    """
    Build an OptionalIntervalVar on the shared week-quarter axis so that all
    slots for the same lamp (across workers and days) can be NoOverlap'd.
    Uses wq_exp so that start indices in the expanded coordinate map correctly.
    """
    tl = sv.slot.timeline
    wq = list(tl.wq_exp)
    horizon = HORIZON_Q + 1

    if not wq:
        z = model.NewConstant(0)
        s = model.NewIntVar(0, 0, f"lws_{tag}")
        e = model.NewIntVar(0, 0, f"lwe_{tag}")
        return model.NewOptionalIntervalVar(s, z, e, sv.presence, f"lamp_{tag}")

    start_wq = model.NewIntVar(0, horizon, f"lws_{tag}")
    model.AddElement(sv.start, wq, start_wq)

    cap_exp = len(wq)
    end_local = model.NewIntVar(0, max(0, cap_exp - 1), f"lel_{tag}")
    model.Add(end_local == sv.start + sv.size - 1).OnlyEnforceIf(sv.presence)
    model.Add(end_local == 0).OnlyEnforceIf(sv.presence.Not())

    end_wq = model.NewIntVar(0, horizon, f"lwe_{tag}")
    model.AddElement(end_local, [q + 1 for q in wq], end_wq)

    dur = model.NewIntVar(0, horizon, f"ldur_{tag}")
    model.Add(dur == end_wq - start_wq).OnlyEnforceIf(sv.presence)
    model.Add(dur == 0).OnlyEnforceIf(sv.presence.Not())

    return model.NewOptionalIntervalVar(
        start_wq, dur, end_wq, sv.presence, f"lamp_{tag}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Phase 1: prepare domain data (no CP-SAT)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class ProblemData:
    tasks: list[EngineTask]
    demand_q: dict[str, int]  # task_id → pending quarters
    days: list[date]
    week_start: date
    timelines: dict[tuple[str, int], WorkerDayTimeline]
    process_by_code: dict
    prev_q: dict[str, int]  # "task|person|day" → previous quarters
    people: list[EnginePerson]
    lamp_edges: list[LampEdge]
    weights: SchedulerWeights
    fixed_assignments: list[FixedAssignment]
    busy_slots: list[BusySlotEntry]


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
    for person in request.people:
        s = sched_by_person.get(person.id)
        weekly = s.weekly if s else []
        overrides = s.overrides if s else []
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

    weights = _coerce_weights(request, config.weights)
    process_by_code = {p.code: p for p in request.processes}

    return ProblemData(
        tasks=tasks,
        demand_q={t.id: round(t.pendingHours * QUARTERS_PER_HOUR) for t in tasks},
        days=days,
        week_start=week_start,
        timelines=timelines,
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
    """
    Back-compat: if the request carries legacy float weights, map them onto
    SchedulerWeights; otherwise use the config override.
    """
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


# ──────────────────────────────────────────────────────────────────────────────
# Phase 2: build CP-SAT variables
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class ModelVars:
    """All CP-SAT variables, indexed for fast constraint / objective lookup."""

    all_slots: list[SlotVars] = field(default_factory=list)

    # task_id → [SlotVars]
    by_task: dict[str, list[SlotVars]] = field(default_factory=dict)

    # (person_id, day_idx) → [worker_iv]
    worker_day_ivs: dict[tuple[str, int], list[cp_model.IntervalVar]] = field(
        default_factory=dict
    )

    # (lamp_id, day_idx) → [lamp_iv]
    lamp_day_ivs: dict[tuple[str, int], list[cp_model.IntervalVar]] = field(
        default_factory=dict
    )

    # (person_id, day_idx) → [effective IntVar]
    load_by_person_day: dict[tuple[str, int], list[cp_model.IntVar]] = field(
        default_factory=dict
    )


def _build_variables(
    model: cp_model.CpModel,
    data: ProblemData,
) -> ModelVars:
    mv = ModelVars()

    for task in data.tasks:
        proc = data.process_by_code.get(task.process)
        if proc is None:
            continue
        demand = data.demand_q[task.id]
        urgency = _urgency(task, data.week_start)

        for person in pick_candidates(data.people, task.process):
            for day_idx, day in enumerate(data.days):
                tl = data.timelines.get((person.id, day_idx))
                if tl is None or tl.cap <= 0:
                    continue

                cap_exp = len(tl.wq_exp) if tl.wq_exp else tl.cap
                tag = f"{task.id}_{person.id}_{day_idx}"

                presence = model.NewBoolVar(f"p_{tag}")
                start = model.NewIntVar(0, max(0, cap_exp - 1), f"s_{tag}")
                size = model.NewIntVar(0, cap_exp, f"z_{tag}")
                end = model.NewIntVar(0, cap_exp, f"e_{tag}")
                worker_iv = model.NewOptionalIntervalVar(
                    start, size, end, presence, f"wiv_{tag}"
                )

                effective = model.NewIntVar(0, cap_exp, f"eff_{tag}")
                model.Add(effective == size).OnlyEnforceIf(presence)
                model.Add(effective == 0).OnlyEnforceIf(presence.Not())
                # Prevent presence=1, size=0 (would let the objective exploit a
                # zero-cost "phantom" start without scheduling any real work).
                model.Add(size >= 1).OnlyEnforceIf(presence)

                slot = TaskSlot(
                    task_id=task.id,
                    person_id=person.id,
                    lamp_id=task.lampId,
                    day=day,
                    day_index=day_idx,
                    process=task.process,
                    timeline=tl,
                    demand_q=demand,
                    urgency=urgency,
                )
                lamp_iv = _make_lamp_interval(
                    model,
                    _temp_sv(slot, presence, start, size, end, worker_iv, effective),
                    tag,
                )

                sv = SlotVars(
                    slot=slot,
                    presence=presence,
                    start=start,
                    size=size,
                    end=end,
                    worker_iv=worker_iv,
                    lamp_iv=lamp_iv,
                    effective=effective,
                )

                # Prevent tasks from spanning schedule breaks (lunch etc.)
                for gap_start, gap_size in tl.gaps:
                    gap_iv = model.NewFixedSizeIntervalVar(
                        gap_start, gap_size, f"gap_{tag}_{gap_start}"
                    )
                    model.AddNoOverlap([worker_iv, gap_iv])

                mv.all_slots.append(sv)
                mv.by_task.setdefault(task.id, []).append(sv)
                mv.worker_day_ivs.setdefault((person.id, day_idx), []).append(worker_iv)
                mv.lamp_day_ivs.setdefault((task.lampId, day_idx), []).append(lamp_iv)
                mv.load_by_person_day.setdefault((person.id, day_idx), []).append(
                    effective
                )

    return mv


def _temp_sv(slot, presence, start, size, end, worker_iv, effective) -> SlotVars:
    """Partial SlotVars used only during lamp-interval construction."""
    sv = object.__new__(SlotVars)
    sv.slot = slot
    sv.presence = presence
    sv.start = start
    sv.size = size
    sv.end = end
    sv.worker_iv = worker_iv
    sv.lamp_iv = None  # filled after
    sv.effective = effective
    return sv


# ──────────────────────────────────────────────────────────────────────────────
# Phase 3: add constraints
# ──────────────────────────────────────────────────────────────────────────────


def _add_constraints(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> dict[str, cp_model.IntVar]:
    """
    Returns unscheduled[task_id] → IntVar (remaining quarters not covered).
    """
    unscheduled: dict[str, cp_model.IntVar] = {}

    # ── 1. Coverage: sum of effective sizes + unscheduled = demand ──────────
    for task in data.tasks:
        pq = data.demand_q[task.id]
        u = model.NewIntVar(0, pq, f"u_{task.id}")
        unscheduled[task.id] = u
        sizes = [sv.effective for sv in mv.by_task.get(task.id, [])]
        if sizes:
            model.Add(sum(sizes) + u == pq)
        else:
            model.Add(u == pq)

    # ── 2. Worker NoOverlap: one block per worker per day ───────────────────
    for ivs in mv.worker_day_ivs.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # ── 3. Lamp NoOverlap: same lamp can't run in parallel on the same day ──
    for ivs in mv.lamp_day_ivs.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # ── 4. Lamp ordering with optional dry time ──────────────────────────────
    _add_lamp_ordering(model, data, mv)
    _add_min_week_quarter(model, data.tasks, mv)

    # ── 5. canFragment=False: at most one active slot per task ───────────────
    _add_no_fragment_constraints(model, data, mv)

    return unscheduled


def _match_ui_start(
    tl: WorkerDayTimeline,
    start_slot: float,
    hours: float,
) -> int | None:
    size_q = round(hours * QUARTERS_PER_HOUR)
    if size_q <= 0 or tl.cap <= 0:
        return None
    for i, ui in enumerate(tl.ui_slot):
        if abs(ui - start_slot) < 0.02 and i + size_q <= tl.cap:
            return i
    best: int | None = None
    best_dist = 1e9
    for i, ui in enumerate(tl.ui_slot):
        dist = abs(ui - start_slot)
        if dist < best_dist and i + size_q <= tl.cap:
            best_dist = dist
            best = i
    return best


def _find_slot_var(
    mv: ModelVars,
    task_id: str,
    person_id: str,
    day_idx: int,
) -> SlotVars | None:
    for sv in mv.by_task.get(task_id, []):
        if sv.slot.person_id == person_id and sv.slot.day_index == day_idx:
            return sv
    return None


def _inject_busy_slots(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    """Block worker timeline slots occupied by planning in other naves."""
    for idx, busy in enumerate(data.busy_slots):
        day_idx = (busy.date - data.week_start).days
        if day_idx < 0 or day_idx >= len(data.days):
            continue
        tl = data.timelines.get((busy.personId, day_idx))
        if tl is None or tl.cap <= 0:
            continue
        local_start = _match_ui_start(tl, busy.startSlot, busy.hours)
        if local_start is None:
            continue
        size_q = round(busy.hours * QUARTERS_PER_HOUR)
        if size_q <= 0:
            continue
        tag = f"busy_{busy.personId}_{day_idx}_{idx}"
        busy_iv = model.NewFixedSizeIntervalVar(
            local_start, size_q, f"biv_{tag}"
        )
        mv.worker_day_ivs.setdefault((busy.personId, day_idx), []).append(busy_iv)


def _apply_fixed_assignments(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    for fixed in data.fixed_assignments:
        day_idx = (fixed.date - data.week_start).days
        if day_idx < 0 or day_idx >= len(data.days):
            continue
        tl = data.timelines.get((fixed.personId, day_idx))
        if tl is None or tl.cap <= 0:
            continue
        local_start = _match_ui_start(tl, fixed.startSlot, fixed.hours)
        if local_start is None:
            continue
        size_q = round(fixed.hours * QUARTERS_PER_HOUR)
        sv = _find_slot_var(mv, fixed.taskId, fixed.personId, day_idx)
        if sv is None:
            continue
        model.Add(sv.presence == 1)
        model.Add(sv.start == local_start)
        model.Add(sv.size == size_q)


def _add_lamp_ordering(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    """
    For each lamp edge (pred → succ, dry_q):
    - If pred is fully scheduled this week, succ may only start ≥ pred_end + dry_q.
    - If pred is not fully scheduled, succ is blocked (can't start before pred finishes).

    Rationale: we never want succ painted on the wall before pred is dry.
    """
    for edge in data.lamp_edges:
        pred_demand = data.demand_q.get(edge.predecessor_id, 0)
        if pred_demand <= 0:
            continue

        pred_slots = mv.by_task.get(edge.predecessor_id, [])
        succ_slots = mv.by_task.get(edge.successor_id, [])
        if not pred_slots or not succ_slots:
            continue

        # pred_done = 1 iff all demand is covered
        pred_done = model.NewBoolVar(f"done_{edge.predecessor_id}")
        total_pred = model.NewIntVar(0, pred_demand, f"tp_{edge.predecessor_id}")
        model.Add(total_pred == sum(sv.effective for sv in pred_slots))
        model.Add(total_pred == pred_demand).OnlyEnforceIf(pred_done)
        model.Add(total_pred < pred_demand).OnlyEnforceIf(pred_done.Not())

        # Latest week-quarter end of any pred slot
        pred_end = model.NewIntVar(0, HORIZON_Q + 1, f"pend_{edge.predecessor_id}")
        for sv in pred_slots:
            wqe = _wq_end_exclusive(
                model, sv, f"pe_{sv.slot.task_id}_{sv.slot.day_index}"
            )
            model.Add(pred_end >= wqe).OnlyEnforceIf(sv.presence)

        # earliest succ can start = pred_end + dry_q (when done); else blocked
        earliest = model.NewIntVar(0, HORIZON_Q + 1, f"early_{edge.successor_id}")
        model.Add(earliest == pred_end + edge.dry_quarters).OnlyEnforceIf(pred_done)
        model.Add(earliest == HORIZON_Q + 1).OnlyEnforceIf(pred_done.Not())

        for sv in succ_slots:
            wqs = _wq_start(model, sv, f"ss_{sv.slot.task_id}_{sv.slot.day_index}")
            model.Add(wqs >= earliest).OnlyEnforceIf(sv.presence)
            # If pred not done, succ can't be scheduled at all
            model.Add(sv.presence == 0).OnlyEnforceIf(pred_done.Not())


def _add_min_week_quarter(
    model: cp_model.CpModel,
    tasks: list[EngineTask],
    mv: ModelVars,
) -> None:
    """Earliest start from predecessors planned in prior weeks (minWeekQuarter)."""
    for task in tasks:
        min_wq = task.minWeekQuarter or 0
        if min_wq <= 0:
            continue
        for sv in mv.by_task.get(task.id, []):
            wqs = _wq_start(
                model, sv, f"mn_{sv.slot.task_id}_{sv.slot.day_index}"
            )
            model.Add(wqs >= min_wq).OnlyEnforceIf(sv.presence)


# ──────────────────────────────────────────────────────────────────────────────
# Phase 4: objective function
# ──────────────────────────────────────────────────────────────────────────────


def _build_objective(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    unscheduled: dict[str, cp_model.IntVar],
) -> None:
    """
    Tiered minimisation objective.

    Tier 0 ×10⁶  — coverage  (never sacrifice a scheduled quarter for anything)
    Tier 1 ×10³  — deadlines (finish lamps before delivery date)
    Tier 2 ×1    — cost, stability, load balance
    """
    w = data.weights
    terms: list = []

    # ── Tier 0: Coverage ─────────────────────────────────────────────────────
    w0 = _scale(w.coverage)
    if w0 > 0:
        terms.append(TIER_COVERAGE * w0 * sum(unscheduled.values()))

    # ── Tier 1: Deadlines ────────────────────────────────────────────────────
    w1 = _scale(w.deadline)
    if w1 > 0:
        _add_deadline_terms(model, data, mv, w1, terms)

    # ── Tier 2: Labour cost ──────────────────────────────────────────────────
    w_labor = _scale(w.labor_cost)
    if w_labor > 0:
        _add_labor_terms(model, data, mv, w_labor, terms)

    # ── Tier 2: Stability (minimize movement vs. previous plan) ──────────────
    w_stab = _scale(w.stability)
    if w_stab > 0:
        _add_stability_terms(model, data, mv, w_stab, terms)

    # ── Tier 2: Load balance ─────────────────────────────────────────────────
    w_bal = _scale(w.load_balance)
    if w_bal > 0:
        _add_balance_terms(model, data, mv, w_bal, terms)

    # ── Tier 2: Split penalty ────────────────────────────────────────────────
    w_split = _scale(w.split_penalty)
    if w_split > 0:
        _add_split_terms(model, data, mv, w_split, terms)

    # ── Tier 2: Gap penalty (prevent fragmented interleaving) ────────────────
    w_gap = _scale(w.gap_penalty)
    if w_gap > 0:
        _add_gap_terms(model, data, mv, w_gap, terms)

    # ── Tier 1: Project priority by delivery proximity ───────────────────────
    w_prio = _scale(w.project_priority)
    if w_prio > 0:
        _add_project_priority_terms(model, data, mv, w_prio, terms)

    # ── Tier 2: Early-start nudge ────────────────────────────────────────────
    w_es = _scale(w.early_start)
    if w_es > 0:
        _add_early_start_terms(model, data, mv, w_es, terms)

    if terms:
        model.Minimize(sum(terms))


def _scale(v: float) -> int:
    return max(0, int(v * _SCALE))


def _add_deadline_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    """
    Per-lamp: penalise (lamp_end − delivery_target_q) when positive.
    Urgency multiplier amplifies near-deadline lamps within the tier.
    """
    by_lamp: dict[str, list[EngineTask]] = defaultdict(list)
    for t in data.tasks:
        by_lamp[t.lampId].append(t)

    for lamp_id, lamp_tasks in by_lamp.items():
        lamp_slots: list[SlotVars] = []
        for t in lamp_tasks:
            lamp_slots.extend(mv.by_task.get(t.id, []))
        if not lamp_slots:
            continue

        end_vars = [
            _wq_end_exclusive(
                model, sv, f"le_{lamp_id}_{sv.slot.task_id}_{sv.slot.day_index}"
            )
            for sv in lamp_slots
        ]
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

        urgency_w = int(
            data.weights.urgency_scale * sample.urgency
            if hasattr(sample, "urgency")
            else _urgency(sample, data.week_start)
        )
        coef = TIER_DEADLINE * w * urgency_w
        terms.append(coef * late_q)

        # Soft bonus: finish earlier is better when delivery is this week
        if delivery is not None:
            days_left = (delivery - data.week_start).days
            if 0 <= days_left < HORIZON_DAYS:
                terms.append(TIER_DEADLINE * (w // 2) * lamp_end)


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
    for sv in mv.all_slots:
        key = f"{sv.slot.task_id}|{sv.slot.person_id}|{sv.slot.day_index}"
        prev = data.prev_q.get(key, 0)
        if prev <= 0:
            continue
        diff = model.NewIntVar(0, sv.slot.timeline.cap, f"stab_{key}")
        model.Add(diff >= sv.effective - prev)
        model.Add(diff >= prev - sv.effective)
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
        person_slots = [sv for sv in mv.all_slots if sv.slot.person_id == person.id]
        if not person_slots:
            continue
        pt = model.NewIntVar(0, max_week_load, f"load_{person.id}")
        model.Add(pt == sum(sv.effective for sv in person_slots))
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
    """
    Penalise splitting a task across more slots than necessary.

    For each task we count how many slots are active: sum(presence_i).
    The first slot is "free" — we only penalise the extras beyond 1.

        extra_blocks = max(0, sum(presence_i) − 1)

    Minimising this pushes the solver toward fewer, larger blocks.

    Note: the coverage constraint already forces enough total quarters to be
    assigned, so the solver can't cheat by merging blocks at the cost of
    leaving work unscheduled — the only way to reduce extra_blocks is to
    genuinely consolidate work into longer contiguous runs.
    """
    for task in data.tasks:
        slots = mv.by_task.get(task.id, [])
        if len(slots) < 2:
            continue  # can't split if there's only one candidate slot

        # Number of active slots for this task (0 … len(slots))
        n_active = model.NewIntVar(0, len(slots), f"nact_{task.id}")
        model.Add(n_active == sum(sv.presence for sv in slots))

        # extra = n_active − 1, clamped to 0 (free if task uses exactly 1 slot)
        extra = model.NewIntVar(0, len(slots) - 1, f"xtra_{task.id}")
        model.Add(extra >= n_active - 1)
        model.Add(extra >= 0)

        terms.append(TIER_COST * w * extra)


def _add_early_start_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    """Penalise each active slot's start position on the week timeline.

    By penalising *every* fragment (not just the task's first start), early_start
    combines naturally with gap_penalty: the solver prefers fewer, earlier blocks
    because each extra fragment adds its own wq_start cost.  A task split into
    slots at quarters 5+20+40 costs 65w; the same task in one block at quarter 5
    costs 5w — the solver consolidates.
    """
    for sv in mv.all_slots:
        wq = sv.slot.timeline.wq_exp
        if not wq:
            continue
        tag = f"{sv.slot.task_id}_{sv.slot.person_id}_{sv.slot.day_index}"
        start_wq = model.NewIntVar(0, HORIZON_Q + 1, f"eswq_{tag}")
        model.AddElement(sv.start, list(wq), start_wq)
        eff_wq = model.NewIntVar(0, HORIZON_Q + 1, f"eseff_{tag}")
        model.Add(eff_wq == start_wq).OnlyEnforceIf(sv.presence)
        model.Add(eff_wq == 0).OnlyEnforceIf(sv.presence.Not())
        terms.append(TIER_COST * w * eff_wq)


def _delivery_urgency_score(task: EngineTask, week_start: date) -> int:
    """Continuous urgency score 0–90 (higher = more urgent).

    Differentiates projects within the 'far deadline' bucket that _urgency()
    collapses to a single level (e.g. 51d vs 143d are both urgency=1 there).

    Returns:
        90  for overdue or due today
        39  for 51 days out  (90-51)
        0   for ≥90 days out or no deadline
    """
    if task.projectDeliveryDate is None:
        return 0
    days_left = (task.projectDeliveryDate.date() - week_start).days
    if days_left <= 0:
        return 90
    return max(0, 90 - days_left)


def _add_project_priority_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    """Tier 1: prefer filling slots for projects with closer delivery dates.

    For each active slot the cost is (90 - urgency_score) × w × effective, so
    closer-deadline tasks have a lower cost per quarter and the solver naturally
    fills them before distant-deadline tasks when resources are shared.

    Example with w=2500 (deliveryPriority=50%):
      DRUNI Splau  (51d)  → inverse=51  → 51×2500 per quarter
      ARENAL El Rosal (143d) → inverse=90  → 90×2500 per quarter
    The solver prefers Splau (lower cost), resolving the priority inversion.
    """
    task_inverse: dict[str, int] = {}
    for task in data.tasks:
        score = _delivery_urgency_score(task, data.week_start)
        task_inverse[task.id] = 90 - score  # 0 = most urgent, 90 = no deadline

    for task in data.tasks:
        inv = task_inverse.get(task.id, 90)
        if inv <= 0:
            continue  # overdue/due-today: schedule for free
        for sv in mv.by_task.get(task.id, []):
            terms.append(TIER_DEADLINE * w * inv * sv.effective)


def _add_no_fragment_constraints(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
) -> None:
    """Enforce canFragment=False: task uses at most one (task, person, day) slot."""
    for task in data.tasks:
        if task.canFragment:
            continue
        slots = mv.by_task.get(task.id, [])
        if len(slots) > 1:
            model.Add(sum(sv.presence for sv in slots) <= 1)


def _add_gap_terms(
    model: cp_model.CpModel,
    data: ProblemData,
    mv: ModelVars,
    w: int,
    terms: list,
) -> None:
    """Penalise the day-span of each (task, worker) assignment.

    For each (task, worker) pair that has slots on multiple days, computes:
        span = last_active_day_index − first_active_day_index
    and adds w * span to the objective.

    This correctly handles non-adjacent splits (e.g. Mon+Thu gives span=3,
    not 0 as the old pair-wise approach would give when intermediate days are
    absent).  Single-day assignments contribute span=0.
    """
    H = len(data.days)  # number of schedulable days (5)

    by_task_person: dict[tuple[str, str], list[SlotVars]] = defaultdict(list)
    for sv in mv.all_slots:
        by_task_person[(sv.slot.task_id, sv.slot.person_id)].append(sv)

    for (task_id, person_id), slots in by_task_person.items():
        if len(slots) < 2:
            continue

        # Build per-slot min/max day-index contributions.
        # When present: contribute the actual day_index.
        # For the minimum: absent slots contribute H (won't win the min).
        # For the maximum: absent slots contribute 0 (won't win the max).
        min_vars: list = []
        max_vars: list = []
        for sv in slots:
            di = sv.slot.day_index
            fv = model.NewIntVar(0, H, f"fday_{task_id}_{person_id}_{di}")
            model.Add(fv == di).OnlyEnforceIf(sv.presence)
            model.Add(fv == H).OnlyEnforceIf(sv.presence.Not())
            min_vars.append(fv)

            lv = model.NewIntVar(0, H, f"lday_{task_id}_{person_id}_{di}")
            model.Add(lv == di).OnlyEnforceIf(sv.presence)
            model.Add(lv == 0).OnlyEnforceIf(sv.presence.Not())
            max_vars.append(lv)

        first_day = model.NewIntVar(0, H, f"fday_min_{task_id}_{person_id}")
        last_day = model.NewIntVar(0, H, f"lday_max_{task_id}_{person_id}")
        model.AddMinEquality(first_day, min_vars)
        model.AddMaxEquality(last_day, max_vars)

        # span ≥ last − first (minimisation drives it to exactly max(0, last−first)).
        # When all absent: last=0, first=H → last−first ≤ 0, so span=0.
        span = model.NewIntVar(0, H, f"span_{task_id}_{person_id}")
        model.Add(span >= last_day - first_day)
        terms.append(TIER_COST * w * span)


# ──────────────────────────────────────────────────────────────────────────────
# Phase 5: solve + extract
# ──────────────────────────────────────────────────────────────────────────────


def solve_week(
    request: SolveRequest,
    config: SchedulerConfig | None = None,
) -> SolveResponse:
    """
    Main entry point.

    Parameters
    ----------
    request : SolveRequest
        Full scheduling request (tasks, workers, schedules, etc.)
    config : SchedulerConfig, optional
        Solver configuration including weights.  Defaults to SchedulerConfig()
        which uses SchedulerWeights() defaults.
    """
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
    mv = _build_variables(model, data)
    _inject_busy_slots(model, data, mv)
    unscheduled = _add_constraints(model, data, mv)
    _apply_fixed_assignments(model, data, mv)
    _build_objective(model, data, mv, unscheduled)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = config.max_solve_seconds
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _infeasible_response(data.tasks, status, solver)

    return _extract_solution(
        mv.all_slots,
        unscheduled,
        solver,
        request.fixedAssignments,
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
    slots: list[SlotVars],
    unscheduled: dict[str, cp_model.IntVar],
    solver: cp_model.CpSolver,
    fixed_list: list[FixedAssignment],
) -> SolveResponse:
    assignments: list[EngineAssignment] = []

    for sv in slots:
        if not solver.Value(sv.presence):
            continue
        size_q = solver.Value(sv.effective)
        if size_q <= 0:
            continue
        start_q = solver.Value(sv.start)
        tl = sv.slot.timeline
        assignments.append(
            EngineAssignment(
                taskId=sv.slot.task_id,
                personId=sv.slot.person_id,
                date=sv.slot.day,
                startSlot=tl.ui_start_exp(start_q),
                endSlot=tl.ui_end_exp(start_q, size_q),
                hours=size_q / QUARTERS_PER_HOUR,
                process=sv.slot.process,
                isAfternoon=tl.is_afternoon_exp(start_q),
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

    seen = {
        (a.taskId, a.personId, a.date, a.startSlot) for a in assignments
    }
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
