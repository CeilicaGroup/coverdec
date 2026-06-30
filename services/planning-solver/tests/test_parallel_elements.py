"""Parallel element chains within the same lamp."""

from datetime import date, datetime

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
from conftest import run_solve

WEEK_START = date(2026, 5, 4)
DEFAULT_WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]
WEEKLY = [
    PersonScheduleDayInput(dayOfWeek=d, windows=DEFAULT_WINDOWS) for d in range(1, 6)
]


def test_parallel_elements_same_lamp_can_overlap():
    """Two elements on the same lamp may run CNC concurrently."""
    worker_a = EnginePerson(
        id="worker-a",
        iniciales="WA",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    worker_b = EnginePerson(
        id="worker-b",
        iniciales="WB",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    monday = WEEK_START
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[EngineProcessDef(code="CNC", waitHours=0)],
            people=[worker_a, worker_b],
            tasks=[
                EngineTask(
                    id="cnc-elem-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    lampElementId="elem-1",
                    order=0,
                    process="CNC",
                    pendingHours=4,
                ),
                EngineTask(
                    id="cnc-elem-2",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    lampElementId="elem-2",
                    order=1000,
                    process="CNC",
                    pendingHours=4,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=[
                PersonScheduleInput(personId="worker-a", weekly=WEEKLY, overrides=[]),
                PersonScheduleInput(personId="worker-b", weekly=WEEKLY, overrides=[]),
            ],
        ),
    )

    assert result.unscheduledHours == 0
    monday_assignments = [a for a in result.assignments if a.date == monday]
    assert len(monday_assignments) == 2
    task_ids = {a.taskId for a in monday_assignments}
    assert task_ids == {"cnc-elem-1", "cnc-elem-2"}

    by_task = {a.taskId: a for a in monday_assignments}
    a_start = by_task["cnc-elem-1"].startSlot
    b_start = by_task["cnc-elem-2"].startSlot
    a_end = by_task["cnc-elem-1"].endSlot
    b_end = by_task["cnc-elem-2"].endSlot
    overlap = a_start < b_end and b_start < a_end
    assert overlap, "element CNC tasks should overlap on the same day"
