"""Tasks that require N workers scheduled simultaneously (e.g. chapas: 2 people)."""

from __future__ import annotations

from datetime import date, datetime

from conftest import run_solve
from app.model.work_order_collapse import collapse_work_order_tasks
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


def _cnc_person(person_id: str, iniciales: str) -> EnginePerson:
    return EnginePerson(
        id=person_id,
        iniciales=iniciales,
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )


def test_two_required_workers_task_gets_synchronized_assignments():
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[EngineProcessDef(code="CNC")],
            people=[_cnc_person("op-a", "OA"), _cnc_person("op-b", "OB")],
            tasks=[
                EngineTask(
                    id="t-chapa",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=4,
                    requiredWorkers=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["op-a", "op-b"]),
        ),
    )

    assignments = [a for a in result.assignments if a.taskId == "t-chapa"]
    assert len(assignments) == 2, "expected one assignment row per required worker"
    person_ids = {a.personId for a in assignments}
    assert person_ids == {"op-a", "op-b"}, "expected two distinct workers"

    first, second = assignments
    assert first.date == second.date
    assert first.startSlot == second.startSlot
    assert first.endSlot == second.endSlot
    # Regression guard: each worker must be credited the FULL task duration,
    # not half of it — summing two synchronized-and-equal blocks would halve
    # the apparent hours if progress were double-counted.
    assert abs(first.hours - 4) < 0.1
    assert abs(second.hours - 4) < 0.1


def test_required_workers_task_stays_unscheduled_with_a_single_candidate():
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[EngineProcessDef(code="CNC")],
            people=[_cnc_person("op-a", "OA")],
            tasks=[
                EngineTask(
                    id="t-chapa",
                    projectId="p1",
                    projectPriority=50,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=4,
                    requiredWorkers=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["op-a"]),
        ),
    )

    assignments = [a for a in result.assignments if a.taskId == "t-chapa"]
    assert assignments == [], "must not partially staff a requiredWorkers=2 task"
    assert abs(result.unscheduledHours - 4) < 0.1


def test_work_order_with_required_workers_member_is_not_collapsed():
    members = [
        EngineTask(
            id="t-chapa",
            projectId="p1",
            projectPriority=50,
            lampId="l1",
            order=0,
            process="CNC",
            pendingHours=4,
            requiredWorkers=2,
            workOrderId="wo-1",
            workOrderSequence=0,
        ),
        EngineTask(
            id="t-embalaje",
            projectId="p1",
            projectPriority=50,
            lampId="l1",
            order=1,
            process="CNC",
            pendingHours=1,
            workOrderId="wo-1",
            workOrderSequence=1,
        ),
    ]
    people = [_cnc_person("op-a", "OA"), _cnc_person("op-b", "OB")]

    out_tasks, groups, _candidate_ids, member_to_synthetic = collapse_work_order_tasks(
        members, people, fixed_task_ids=set()
    )

    assert groups == {}
    assert member_to_synthetic == {}
    assert {t.id for t in out_tasks} == {"t-chapa", "t-embalaje"}
