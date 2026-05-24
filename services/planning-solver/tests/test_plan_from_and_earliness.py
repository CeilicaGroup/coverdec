from datetime import date, datetime

from conftest import run_solve
from app.model.solve_week import SchedulerConfig, SchedulerWeights, solve_week
from app.model.timeline import minute_to_week_quarter
from app.schemas import (
    BookedHoursEntry,
    EnginePerson,
    EngineProcessDef,
    EngineTask,
    FixedAssignment,
    PersonScheduleDayInput,
    PersonScheduleInput,
    PlanningWeights,
    SolveRequest,
    WorkWindowMinutes,
)

WEEK_START = date(2026, 5, 4)  # Monday

DEFAULT_WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]

WEEKLY = [
    PersonScheduleDayInput(dayOfWeek=d, windows=DEFAULT_WINDOWS) for d in range(1, 6)
]


def _person() -> EnginePerson:
    return EnginePerson(
        id="op1",
        iniciales="OP",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )


def _request(
    tasks: list[EngineTask],
    **kwargs,
) -> SolveRequest:
    return SolveRequest(
        weekStart=WEEK_START,
        processes=[EngineProcessDef(code="CNC")],
        people=[_person()],
        tasks=tasks,
        weights=PlanningWeights(
            wLate=1, wUnscheduled=1, wLoadBalance=0, wMove=0, wLaborCost=0
        ),
        schedules=[PersonScheduleInput(personId="op1", weekly=WEEKLY, overrides=[])],
        **kwargs,
    )


def test_early_start_prefers_monday_over_friday():
    task = EngineTask(
        id="t1",
        projectId="p1",
        projectPriority=10,
        projectDeliveryDate=datetime(2026, 6, 1),
        lampId="l1",
        order=0,
        process="CNC",
        pendingHours=2,
    )
    config = SchedulerConfig(
        weights=SchedulerWeights(
            early_start=0.3,
            labor_cost=0,
            load_balance=0,
            stability=0,
            split_penalty=0,
        ),
    )
    result = solve_week(_request([task]), config)
    assert result.assignments
    monday = date(2026, 5, 4)
    friday = date(2026, 5, 8)
    monday_hours = sum(a.hours for a in result.assignments if a.date == monday)
    friday_hours = sum(a.hours for a in result.assignments if a.date == friday)
    assert monday_hours >= friday_hours


def test_plan_from_today_skips_monday_when_midweek():
    """Wednesday anchor → no assignments on Mon/Tue."""
    task = EngineTask(
        id="t1",
        projectId="p1",
        projectPriority=10,
        projectDeliveryDate=datetime(2026, 6, 1),
        lampId="l1",
        order=0,
        process="CNC",
        pendingHours=4,
    )
    wednesday = date(2026, 5, 6)  # day-index 2 from Monday 2026-05-04
    first_wq = minute_to_week_quarter(2, 8 * 60)
    result = run_solve(
        _request(
            [task],
            firstSchedulableDayIndex=2,
            firstSchedulableWeekQuarter=first_wq,
        ),
    )
    monday = date(2026, 5, 4)
    tuesday = date(2026, 5, 5)
    assert not any(a.date == monday for a in result.assignments)
    assert not any(a.date == tuesday for a in result.assignments)
    assert any(a.date >= wednesday for a in result.assignments)


def test_booked_hours_reduces_assignable_capacity():
    # Use a small task (2h) that deterministically lands on Monday morning.
    # Then book the full day (8h) so Monday capacity drops to 0 — comparison is unambiguous.
    task = EngineTask(
        id="t1",
        projectId="p1",
        projectPriority=10,
        projectDeliveryDate=datetime(2026, 6, 1),
        lampId="l1",
        order=0,
        process="CNC",
        pendingHours=2,
    )
    monday = date(2026, 5, 4)
    full = run_solve(_request([task]))
    full_hours = sum(a.hours for a in full.assignments if a.date == monday)

    booked = run_solve(
        _request(
            [task],
            bookedHours=[
                BookedHoursEntry(personId="op1", date=monday, hours=8),
            ],
        ),
    )
    booked_hours = sum(a.hours for a in booked.assignments if a.date == monday)
    assert full_hours > 0, f"Without booking, early_start should place work on Monday; got {full_hours}"
    assert booked_hours == 0, f"With full day booked, Monday capacity is 0; got {booked_hours}"


def test_early_start_schedules_successor_next_day_not_later():
    """
    After a 6h CNC task on Monday, ENSAMBLAJE (0 wait) should land on Tuesday,
    not skip to Wednesday or later.  Verifies the early_start objective actually
    pulls tasks forward (was broken: task_first_wq was always 0).
    """
    cnc_worker = EnginePerson(
        id="daniil",
        iniciales="DS",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )
    ens_worker = EnginePerson(
        id="ihor",
        iniciales="IA",
        primary=["ENSAMBLAJE"],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )
    monday = WEEK_START
    tuesday = date(2026, 5, 5)

    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="CNC", waitHours=0),
                EngineProcessDef(code="ENSAMBLAJE", waitHours=0),
            ],
            people=[cnc_worker, ens_worker],
            tasks=[
                EngineTask(
                    id="cnc-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 27),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=6,
                ),
                EngineTask(
                    id="ens-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 27),
                    lampId="l1",
                    order=1,
                    process="ENSAMBLAJE",
                    pendingHours=3,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=[
                PersonScheduleInput(personId="daniil", weekly=WEEKLY, overrides=[]),
                PersonScheduleInput(personId="ihor", weekly=WEEKLY, overrides=[]),
            ],
        ),
    )
    assert result.unscheduledHours == 0

    cnc_dates = {a.date for a in result.assignments if a.taskId == "cnc-1"}
    ens_dates = {a.date for a in result.assignments if a.taskId == "ens-1"}
    assert monday in cnc_dates, "CNC should be on Monday"
    # ENSAMBLAJE must not skip a day — earliest possible is Tuesday
    assert min(ens_dates) <= tuesday, (
        f"ENSAMBLAJE should start by Tuesday, got {min(ens_dates)}"
    )
    # And it must start at 08:00 (startSlot = 0.0)
    ens_starts = [a.startSlot for a in result.assignments if a.taskId == "ens-1"]
    assert min(ens_starts) < 0.1, (
        f"ENSAMBLAJE should start at 08:00 (slot 0), got {min(ens_starts)}"
    )


def test_afternoon_used_when_morning_full():
    """When a worker's morning is full, a second task should use the afternoon."""
    worker = EnginePerson(
        id="op1",
        iniciales="OP",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )
    # Two tasks for the same worker and process, each on their own lamp.
    # task-A uses 6h (entire morning). task-B (2h) should land in Monday afternoon
    # rather than being pushed to Tuesday, since the afternoon is available.
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[EngineProcessDef(code="CNC")],
            people=[worker],
            tasks=[
                EngineTask(
                    id="task-a",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="lamp-a",
                    order=0,
                    process="CNC",
                    pendingHours=6,
                ),
                EngineTask(
                    id="task-b",
                    projectId="p2",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="lamp-b",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=[PersonScheduleInput(personId="op1", weekly=WEEKLY, overrides=[])],
        ),
    )
    assert result.unscheduledHours == 0
    monday = date(2026, 5, 4)
    b_on_monday = [a for a in result.assignments if a.taskId == "task-b" and a.date == monday]
    assert b_on_monday, "task-b should use Monday afternoon when Monday morning is full"
    assert any(a.isAfternoon for a in b_on_monday), "task-b Monday slot should be in the afternoon"


def test_canFragment_false_schedules_single_slot():
    """A task with canFragment=False must appear on exactly one date."""
    task = EngineTask(
        id="t1",
        projectId="p1",
        projectPriority=10,
        projectDeliveryDate=datetime(2026, 6, 1),
        lampId="l1",
        order=0,
        process="CNC",
        pendingHours=3,
        canFragment=False,
    )
    result = run_solve(_request([task]))
    assert result.unscheduledHours == 0
    t1_dates = {a.date for a in result.assignments if a.taskId == "t1"}
    assert len(t1_dates) == 1, f"canFragment=False task must be on exactly one date; got {t1_dates}"


def test_fixed_assignment_preserved_in_output():
    monday = date(2026, 5, 4)
    fixed = FixedAssignment(
        taskId="done-1",
        personId="op1",
        date=monday,
        startSlot=0.0,
        endSlot=2.0,
        hours=2.0,
        process="CNC",
    )
    result = run_solve(
        _request(
            [],
            fixedAssignments=[fixed],
        ),
    )
    assert len(result.assignments) == 1
    a = result.assignments[0]
    assert a.taskId == "done-1"
    assert a.date == monday
    assert abs(a.hours - 2.0) < 0.1
