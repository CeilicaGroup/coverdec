"""Pipeline between dependent work orders on different workers."""

from datetime import date, datetime

from conftest import run_solve
from app.schemas import (
    EnginePerson,
    EngineProcessDef,
    EngineTask,
    PlanningWeights,
    PersonScheduleDayInput,
    PersonScheduleInput,
    SolveRequest,
    WorkOrderPipelineEdge,
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


def _lamp_tasks(
    *,
    lamp_id: str,
    element_id: str,
    process_a_id: str,
    process_b_id: str,
    sequence_index: int,
    hours: float = 1.0,
) -> list[EngineTask]:
    return [
        EngineTask(
            id=process_a_id,
            projectId="p1",
            projectPriority=50,
            projectDeliveryDate=datetime(2026, 6, 1),
            lampId=lamp_id,
            lampElementId=element_id,
            order=0,
            process="PROC_A",
            pendingHours=hours,
            workOrderId="wo-a",
            workOrderSequence=sequence_index,
        ),
        EngineTask(
            id=process_b_id,
            projectId="p1",
            projectPriority=50,
            projectDeliveryDate=datetime(2026, 6, 1),
            lampId=lamp_id,
            lampElementId=element_id,
            order=10,
            process="PROC_B",
            pendingHours=hours,
            workOrderId="wo-b",
            workOrderSequence=sequence_index,
        ),
    ]


def test_pipeline_allows_second_worker_to_start_after_partial_first_ot():
    tasks: list[EngineTask] = []
    for index in range(3):
        tasks.extend(
            _lamp_tasks(
                lamp_id=f"l{index}",
                element_id=f"el-{index}",
                process_a_id=f"a-{index}",
                process_b_id=f"b-{index}",
                sequence_index=index,
            ),
        )

    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="PROC_A"),
                EngineProcessDef(code="PROC_B"),
            ],
            people=[
                EnginePerson(
                    id="op-a",
                    iniciales="OA",
                    primary=["PROC_A"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
                EnginePerson(
                    id="op-b",
                    iniciales="OB",
                    primary=["PROC_B"],
                    fallback=[],
                    capacityHours=8,
                    hourlyRate=14.75,
                    overtimeHourlyRate=22.13,
                ),
            ],
            tasks=tasks,
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["op-a", "op-b"]),
            workOrderPipelines=[
                WorkOrderPipelineEdge(
                    predecessorWorkOrderId="wo-a",
                    successorWorkOrderId="wo-b",
                    minCompletedHours=1.0,
                ),
            ],
        ),
    )

    assert result.unscheduledHours == 0

    by_task: dict[str, list] = {}
    for assignment in result.assignments:
        by_task.setdefault(assignment.taskId, []).append(assignment)

    a1_end = max(a.endSlot + a.date.toordinal() for a in by_task["a-0"])
    b1_start = min(a.startSlot + a.date.toordinal() for a in by_task["b-0"])
    a3_end = max(a.endSlot + a.date.toordinal() for a in by_task["a-2"])

    assert b1_start < a3_end - 1e-6
    assert b1_start >= a1_end - 1e-6

    assert all(a.personId == "op-a" for a in by_task["a-0"])
    assert all(a.personId == "op-b" for a in by_task["b-0"])
