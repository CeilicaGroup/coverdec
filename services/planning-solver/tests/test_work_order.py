"""Work-order grouping: same worker, sequential placement."""

from datetime import date, datetime

from conftest import run_solve
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

DEFAULT_WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]

WEEKLY = [
    PersonScheduleDayInput(dayOfWeek=d, windows=DEFAULT_WINDOWS) for d in range(1, 6)
]


def _schedules(person_ids: list[str]) -> list[PersonScheduleInput]:
    return [
        PersonScheduleInput(personId=pid, weekly=WEEKLY, overrides=[])
        for pid in person_ids
    ]


def test_work_order_assigns_same_worker_in_sequence():
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[EngineProcessDef(code="CNC")],
            people=[
                EnginePerson(
                    id="op-a",
                    iniciales="OA",
                    primary=["CNC"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
                EnginePerson(
                    id="op-b",
                    iniciales="OB",
                    primary=["CNC"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
            ],
            tasks=[
                EngineTask(
                    id="t1",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    workOrderId="wo-1",
                    workOrderSequence=0,
                ),
                EngineTask(
                    id="t2",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l2",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    workOrderId="wo-1",
                    workOrderSequence=1,
                ),
                EngineTask(
                    id="t3",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l3",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    workOrderId="wo-1",
                    workOrderSequence=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["op-a", "op-b"]),
        ),
    )

    assert result.unscheduledHours == 0
    workers = {a.personId for a in result.assignments}
    assert len(workers) == 1

    by_task = {}
    for a in result.assignments:
        by_task.setdefault(a.taskId, []).append(a)
    assert set(by_task.keys()) == {"t1", "t2", "t3"}

    t1_end = max(a.endSlot + a.date.toordinal() for a in by_task["t1"])
    t2_start = min(a.startSlot + a.date.toordinal() for a in by_task["t2"])
    t2_end = max(a.endSlot + a.date.toordinal() for a in by_task["t2"])
    t3_start = min(a.startSlot + a.date.toordinal() for a in by_task["t3"])
    assert t2_start >= t1_end - 1e-6
    assert t3_start >= t2_end - 1e-6


def test_work_order_owner_person_id_pins_worker():
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[EngineProcessDef(code="CNC")],
            people=[
                EnginePerson(
                    id="op-a",
                    iniciales="OA",
                    primary=["CNC"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
                EnginePerson(
                    id="op-b",
                    iniciales="OB",
                    primary=["CNC"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
            ],
            tasks=[
                EngineTask(
                    id="t1",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    ownerPersonId="op-b",
                    workOrderId="wo-1",
                    workOrderSequence=0,
                ),
                EngineTask(
                    id="t2",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l2",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    workOrderId="wo-1",
                    workOrderSequence=1,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["op-a", "op-b"]),
        ),
    )

    assert result.unscheduledHours == 0
    assert all(a.personId == "op-b" for a in result.assignments)


def test_work_order_worker_cannot_interleave_other_tasks():
    """OT blocks for one worker must form a contiguous bundle (no foreign tasks in between)."""
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="CNC"),
                EngineProcessDef(code="FILL"),
            ],
            people=[
                EnginePerson(
                    id="op-a",
                    iniciales="OA",
                    primary=["CNC", "FILL"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
                EnginePerson(
                    id="op-b",
                    iniciales="OB",
                    primary=["CNC"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
            ],
            tasks=[
                EngineTask(
                    id="t-ot-1",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    workOrderId="wo-1",
                    workOrderSequence=0,
                ),
                EngineTask(
                    id="t-ot-2",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l2",
                    order=0,
                    process="CNC",
                    pendingHours=2,
                    workOrderId="wo-1",
                    workOrderSequence=1,
                ),
                EngineTask(
                    id="t-fill",
                    projectId="p1",
                    projectPriority=80,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l3",
                    order=0,
                    process="FILL",
                    pendingHours=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["op-a", "op-b"]),
        ),
    )

    assert result.unscheduledHours == 0
    by_task: dict[str, list] = {}
    for a in result.assignments:
        by_task.setdefault(a.taskId, []).append(a)

    ot_worker = {a.personId for a in by_task["t-ot-1"]}
    assert ot_worker == {a.personId for a in by_task["t-ot-2"]}
    assert len(ot_worker) == 1
    worker = next(iter(ot_worker))

    def timeline_key(assignment):
        return (assignment.date.toordinal(), assignment.startSlot)

    ot_slots = sorted(by_task["t-ot-1"] + by_task["t-ot-2"], key=timeline_key)
    fill_slots = sorted(by_task["t-fill"], key=timeline_key)

    ot_start = timeline_key(ot_slots[0])
    ot_end = max((a.date.toordinal(), a.endSlot) for a in ot_slots)
    fill_start = timeline_key(fill_slots[0])
    fill_end = max((a.date.toordinal(), a.endSlot) for a in fill_slots)

    if fill_slots[0].personId == worker:
        assert fill_end <= ot_start or fill_start >= ot_end
