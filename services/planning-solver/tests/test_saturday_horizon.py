"""Saturday work: horizonDays=6, Saturday capacity only from per-date overrides."""

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from conftest import run_solve
from app.model.timeline import WorkerDayTimeline
from app.schemas import (
    EnginePerson,
    EngineProcessDef,
    EngineTask,
    PersonScheduleDayInput,
    PersonScheduleInput,
    PersonScheduleOverrideInput,
    PlanningWeights,
    SolveRequest,
    SolveResponse,
    WorkWindowMinutes,
)

WEEK_START = date(2026, 5, 4)  # Monday
SATURDAY = date(2026, 5, 9)  # day index 5
NEXT_MONDAY_8AM = datetime(2026, 5, 11, 8, 0)

# Short 2h days (10h/week) keep the placement catalog small so solves stay fast;
# the Saturday logic does not depend on the day length.
SHORT_DAY_WINDOWS = [WorkWindowMinutes(startMinutes=8 * 60, endMinutes=10 * 60)]

WEEKLY = [
    PersonScheduleDayInput(dayOfWeek=d, windows=SHORT_DAY_WINDOWS) for d in range(1, 6)
]

SATURDAY_MORNING = PersonScheduleOverrideInput(
    date=SATURDAY,
    windows=[WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60)],
)


def _person(pid: str, process: str) -> EnginePerson:
    return EnginePerson(
        id=pid,
        iniciales=pid.upper(),
        primary=[process],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )


def _task(
    tid: str,
    process: str,
    hours: float,
    delivery: datetime = datetime(2026, 5, 29),
) -> EngineTask:
    return EngineTask(
        id=tid,
        projectId="p1",
        projectPriority=10,
        projectDeliveryDate=delivery,
        lampId=f"lamp-{tid}",
        order=0,
        process=process,
        pendingHours=hours,
    )


def _request(
    *,
    horizon_days: int,
    a_saturday: bool,
    a_hours: float = 12,
    b_hours: float = 12,
    delivery: datetime = datetime(2026, 5, 29),
) -> SolveRequest:
    """A (CNC) and B (LIJADO) work Mon–Fri 2h/day; each has 12h of work (> 10h)."""
    return SolveRequest(
        weekStart=WEEK_START,
        horizonDays=horizon_days,
        processes=[EngineProcessDef(code="CNC"), EngineProcessDef(code="LIJADO")],
        people=[_person("op-a", "CNC"), _person("op-b", "LIJADO")],
        tasks=[
            _task("cnc-1", "CNC", a_hours, delivery),
            _task("lij-1", "LIJADO", b_hours, delivery),
        ],
        weights=PlanningWeights(
            wLate=1, wUnscheduled=1, wLoadBalance=1, wMove=1, wLaborCost=1
        ),
        schedules=[
            PersonScheduleInput(
                personId="op-a",
                weekly=WEEKLY,
                overrides=[SATURDAY_MORNING] if a_saturday else [],
            ),
            PersonScheduleInput(personId="op-b", weekly=WEEKLY, overrides=[]),
        ],
    )


def _hours(result: SolveResponse, person_id: str, day: date | None = None) -> float:
    return sum(
        a.hours
        for a in result.assignments
        if a.personId == person_id and (day is None or a.date == day)
    )


def _saturday_assignments(result: SolveResponse):
    return [a for a in result.assignments if a.date == SATURDAY]


def _assignment_key(result: SolveResponse):
    return sorted(
        (a.taskId, a.personId, a.date, a.startSlot, a.endSlot, a.hours, a.isAfternoon)
        for a in result.assignments
    )


def test_saturday_override_absorbs_overflow_only_for_that_person():
    result = run_solve(_request(horizon_days=6, a_saturday=True))

    # A: all 12h scheduled, at least the 2h overflow on the Saturday override
    # (08:00–14:00). The exact split may vary within the solver's gap limit.
    assert _hours(result, "op-a") == pytest.approx(12)
    assert 2 <= _hours(result, "op-a", SATURDAY) <= 6
    sat_a = [a for a in _saturday_assignments(result) if a.personId == "op-a"]
    assert all(a.startSlot >= 0 and a.endSlot <= 6 for a in sat_a)

    # B has no Saturday override: nothing on Saturday, 2h stay unscheduled.
    assert _hours(result, "op-b", SATURDAY) == 0
    assert _hours(result, "op-b") == pytest.approx(10)
    assert result.unscheduledHours == pytest.approx(2)


def test_horizon_six_without_overrides_matches_horizon_five():
    six = run_solve(_request(horizon_days=6, a_saturday=False))
    five = run_solve(_request(horizon_days=5, a_saturday=False))

    assert _saturday_assignments(six) == []
    assert all((a.date - WEEK_START).days < 5 for a in six.assignments)
    assert _assignment_key(six) == _assignment_key(five)
    assert six.unscheduledHours == pytest.approx(five.unscheduledHours)
    assert six.unscheduledHours == pytest.approx(4)


def test_horizon_five_ignores_saturday_override():
    result = run_solve(_request(horizon_days=5, a_saturday=True))

    assert _saturday_assignments(result) == []
    assert _hours(result, "op-a") == pytest.approx(10)
    assert result.unscheduledHours == pytest.approx(4)


def test_deadline_next_monday_pulls_late_work_onto_saturday():
    result = run_solve(
        _request(
            horizon_days=6,
            a_saturday=True,
            b_hours=2,
            delivery=NEXT_MONDAY_8AM,
        )
    )

    # The 2h that don't fit Mon–Fri go to Saturday instead of staying pending.
    cnc = [a for a in result.assignments if a.taskId == "cnc-1"]
    assert sum(a.hours for a in cnc) == pytest.approx(12)
    assert max(a.date for a in cnc) == SATURDAY
    assert 2 <= _hours(result, "op-a", SATURDAY) <= 6
    assert not [w for w in result.warnings if w.taskId == "cnc-1"]
    assert result.unscheduledHours == 0

    # Without the Saturday horizon the same 2h would be left unscheduled.
    without = run_solve(
        _request(horizon_days=5, a_saturday=True, b_hours=2, delivery=NEXT_MONDAY_8AM)
    )
    assert without.unscheduledHours == pytest.approx(2)


@pytest.mark.parametrize("weekly", [WEEKLY, []], ids=["template", "no-template"])
def test_saturday_timeline_is_empty_without_override(weekly):
    tl = WorkerDayTimeline.build(
        "op-a", SATURDAY, 5, SATURDAY.isoweekday(), weekly, None, 0.0, None, False, 8.0
    )
    assert tl.cap == 0
    assert tl.contract_q == 0
    assert tl.week_q == ()


def test_saturday_timeline_uses_override_windows():
    tl = WorkerDayTimeline.build(
        "op-a",
        SATURDAY,
        5,
        SATURDAY.isoweekday(),
        WEEKLY,
        SATURDAY_MORNING,
        0.0,
        None,
        False,
        8.0,
    )
    assert tl.cap == 24
    assert tl.contract_q == 24
    assert tl.week_q[0] == 5 * 96 + 8 * 4


def test_weekday_without_template_keeps_default_fallback():
    friday = date(2026, 5, 8)
    tl = WorkerDayTimeline.build(
        "op-a", friday, 4, friday.isoweekday(), [], None, 0.0, None, False, 8.0
    )
    assert tl.cap == 32


@pytest.mark.parametrize("value", [4, 7])
def test_horizon_days_out_of_range_is_rejected(value):
    with pytest.raises(ValidationError):
        _request(horizon_days=value, a_saturday=False)


def test_horizon_days_defaults_to_five():
    req = SolveRequest(
        weekStart=WEEK_START,
        processes=[],
        people=[],
        tasks=[],
        weights=PlanningWeights(wLate=1, wUnscheduled=1, wLoadBalance=1, wMove=1),
    )
    assert req.horizonDays == 5
