"""Verify legacy PlanningWeights map to the tiered SchedulerWeights objective."""

from datetime import date, datetime

from app.model.solve_week import SchedulerConfig, SchedulerWeights, solve_week
from app.schemas import (
    EnginePerson,
    EngineProcessDef,
    EngineTask,
    PersonScheduleDayInput,
    PersonScheduleInput,
    PlanningWeights,
    SolveRequest,
    WorkWindowMinutes,
)

WEEK_START = date(2026, 5, 4)
WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]
WEEKLY = [PersonScheduleDayInput(dayOfWeek=d, windows=WINDOWS) for d in range(1, 6)]


def _minimal_request(weights: PlanningWeights) -> SolveRequest:
    return SolveRequest(
        weekStart=WEEK_START,
        processes=[EngineProcessDef(code="CNC")],
        people=[
            EnginePerson(
                id="p1",
                iniciales="AB",
                primary=["CNC"],
                fallback=[],
                capacityHours=8,
                hourlyRate=10,
                overtimeHourlyRate=15,
            ),
        ],
        tasks=[
            EngineTask(
                id="t1",
                projectId="pr1",
                projectPriority=5,
                projectDeliveryDate=datetime(2026, 5, 15),
                lampId="l1",
                order=0,
                process="CNC",
                pendingHours=2,
            ),
        ],
        weights=weights,
        schedules=[PersonScheduleInput(personId="p1", weekly=WEEKLY, overrides=[])],
    )


def test_coverage_tier_schedules_all_hours_when_only_unscheduled_weighted():
    """Tier 0 (wUnscheduled) must assign every quarter even if cost/deadline weights are 0."""
    result = solve_week(
        _minimal_request(
            PlanningWeights(
                wLate=0,
                wUnscheduled=5,
                wLoadBalance=0,
                wMove=0,
                wLaborCost=0,
            ),
        ),
        SchedulerConfig(max_solve_seconds=30),
    )
    assert result.unscheduledHours == 0
    assert sum(a.hours for a in result.assignments) >= 1.9


def test_scheduler_weights_defaults_are_positive():
    w = SchedulerWeights()
    assert w.coverage > 0
    assert w.deadline > 0
    assert w.split_penalty > 0
    assert w.early_start > 0


def test_legacy_planning_weights_keep_automatic_tier2_nudges():
    """HTTP payload only sends wLate/wUnscheduled/…; split/early_start use solver defaults."""
    from app.model.solve_week import _coerce_weights

    w = _coerce_weights(
        _minimal_request(
            PlanningWeights(
                wLate=2,
                wUnscheduled=3,
                wLoadBalance=0,
                wMove=0,
                wLaborCost=0,
            ),
        ),
        SchedulerWeights(split_penalty=0.0, early_start=0.0),
    )
    assert w.split_penalty == 1.0
    assert w.early_start == 0.3


def test_nonlinear_deadline_score_grows_when_overdue():
    from app.model.solve_week import _delivery_urgency_score

    near_due = EngineTask(
        id="near",
        projectId="pr",
        projectPriority=80,
        projectDeliveryDate=datetime(2026, 5, 8),
        lampId="l1",
        order=0,
        process="CNC",
        pendingHours=1,
        deadlineCurveExponent=2.0,
        overduePenaltyMultiplier=2.5,
    )
    overdue = EngineTask(
        id="overdue",
        projectId="pr",
        projectPriority=80,
        projectDeliveryDate=datetime(2026, 4, 28),
        lampId="l1",
        order=0,
        process="CNC",
        pendingHours=1,
        deadlineCurveExponent=2.0,
        overduePenaltyMultiplier=2.5,
    )

    assert _delivery_urgency_score(overdue, WEEK_START) > _delivery_urgency_score(
        near_due, WEEK_START
    )
