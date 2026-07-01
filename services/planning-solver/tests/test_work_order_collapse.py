"""Unit tests for work-order collapse before CP-SAT."""

from datetime import datetime

from app.model.work_order_collapse import (
    collapse_work_order_tasks,
    expand_collapsed_assignments,
    synthetic_task_id,
)
from app.model.timeline import DailyAssignmentSlice
from app.schemas import EnginePerson, EngineTask


def _task(task_id: str, *, sequence: int, hours: float = 2.0) -> EngineTask:
    return EngineTask(
        id=task_id,
        projectId="p1",
        lampId=f"l-{task_id}",
        order=0,
        process="CNC",
        pendingHours=hours,
        workOrderId="wo-1",
        workOrderSequence=sequence,
    )


def test_collapse_merges_multi_task_work_order():
    people = [
        EnginePerson(
            id="op-a",
            iniciales="OA",
            primary=["CNC"],
            fallback=[],
            capacityHours=8,
            hourlyRate=10,
            overtimeHourlyRate=15,
        ),
    ]
    tasks = [_task("t1", sequence=0), _task("t2", sequence=1), _task("t3", sequence=2)]
    other = EngineTask(
        id="solo",
        projectId="p1",
        lampId="l-solo",
        order=0,
        process="CNC",
        pendingHours=1,
    )

    collapsed, groups, candidates, member_map = collapse_work_order_tasks(
        [*tasks, other],
        people,
        fixed_task_ids=set(),
    )

    synthetic_id = synthetic_task_id("wo-1")
    assert synthetic_id in groups
    assert len(collapsed) == 2
    assert collapsed[0].id == synthetic_id or collapsed[1].id == synthetic_id
    assert member_map["t1"] == synthetic_id
    assert candidates[synthetic_id] == ["op-a"]


def test_expand_splits_hours_in_sequence():
    from app.model.work_order_collapse import WoCollapseGroup, WoMember

    group = WoCollapseGroup(
        synthetic_id="__wo__:wo-1",
        work_order_id="wo-1",
        members=(
            WoMember("t1", 2.0, "CNC"),
            WoMember("t2", 2.0, "CNC"),
        ),
    )
    slices = [
        DailyAssignmentSlice(
            day=datetime(2026, 5, 4).date(),
            day_index=0,
            start_slot=0.0,
            end_slot=4.0,
            hours=4.0,
            is_afternoon=False,
        ),
    ]

    assignments = expand_collapsed_assignments(group, slices, "op-a")
    assert [assignment.taskId for assignment in assignments] == ["t1", "t2"]
    assert sum(assignment.hours for assignment in assignments) == 4.0
