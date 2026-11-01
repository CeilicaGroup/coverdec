"""Merge sub-quarter tasks so quarter rounding applies to their sum, not to each one.

The model works in 15-minute quarters. Rounding every task up separately turns
96 chapas of 1.5 min (2.4 h of real work) into 24 h of planned time. Tasks of
the same OT, lamp, process and chain step are done back to back by the same
worker, so they are planned as one block and split back afterwards.
"""

from __future__ import annotations

import math
from collections import defaultdict

from app.model.timeline import DailyAssignmentSlice
from app.model.work_order_collapse import (
    WoCollapseGroup,
    WoMember,
    expand_collapsed_assignments,
)
from app.schemas import EngineAssignment, EngineTask, SolveResponse

TINY_SYNTHETIC_PREFIX = "__tiny__:"
_QUARTER_HOURS = 0.25


def _raw_hours(task: EngineTask) -> float:
    return task.rawPendingHours if task.rawPendingHours is not None else task.pendingHours


def _is_tiny(task: EngineTask, fixed_task_ids: set[str]) -> bool:
    return (
        task.workOrderId is not None
        and (task.requiredWorkers or 1) == 1
        and task.id not in fixed_task_ids
        and 0 < _raw_hours(task) < _QUARTER_HOURS - 1e-9
    )


def merge_tiny_tasks(
    tasks: list[EngineTask],
    *,
    fixed_task_ids: set[str],
) -> tuple[list[EngineTask], dict[str, WoCollapseGroup], dict[str, str]]:
    """Returns tasks with tiny groups merged, groups by synthetic id, member -> synthetic."""
    by_key: dict[tuple, list[EngineTask]] = defaultdict(list)
    for task in tasks:
        if _is_tiny(task, fixed_task_ids):
            key = (
                task.workOrderId,
                task.projectId,
                task.lampId,
                task.process,
                task.order,
                task.naveId,
                task.ownerPersonId,
                task.canFragment,
            )
            by_key[key].append(task)

    groups: dict[str, WoCollapseGroup] = {}
    synthetics: dict[str, EngineTask] = {}
    member_to_synthetic: dict[str, str] = {}
    for members in by_key.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda t: (t.workOrderSequence or 0, t.id))
        first = members[0]
        synthetic_id = f"{TINY_SYNTHETIC_PREFIX}{first.id}"
        raw_total = sum(_raw_hours(m) for m in members)
        synthetics[synthetic_id] = first.model_copy(
            update={
                "id": synthetic_id,
                "pendingHours": math.ceil(raw_total / _QUARTER_HOURS - 1e-9) * _QUARTER_HOURS,
                "rawPendingHours": raw_total,
                "minWeekQuarter": max(m.minWeekQuarter or 0 for m in members),
            },
        )
        groups[synthetic_id] = WoCollapseGroup(
            synthetic_id=synthetic_id,
            work_order_id=first.workOrderId or "",
            members=tuple(
                WoMember(task_id=m.id, pending_hours=_raw_hours(m), process=m.process)
                for m in members
            ),
        )
        for m in members:
            member_to_synthetic[m.id] = synthetic_id

    if not groups:
        return tasks, {}, {}

    out: list[EngineTask] = []
    for task in tasks:
        synthetic_id = member_to_synthetic.get(task.id)
        if synthetic_id is None:
            out.append(task)
        elif synthetic_id in synthetics:
            out.append(synthetics.pop(synthetic_id))
    return out, groups, member_to_synthetic


def expand_tiny_response(
    response: SolveResponse,
    groups: dict[str, WoCollapseGroup],
) -> SolveResponse:
    """Split each merged block back into its member tasks, in OT order."""
    if not groups:
        return response

    assignments: list[EngineAssignment] = []
    merged: dict[tuple[str, str], list[EngineAssignment]] = defaultdict(list)
    for a in response.assignments:
        if a.taskId in groups:
            merged[(a.taskId, a.personId)].append(a)
        else:
            assignments.append(a)

    for (synthetic_id, person_id), rows in merged.items():
        rows.sort(key=lambda a: (a.date, a.startSlot))
        slices = [
            DailyAssignmentSlice(
                day=a.date,
                day_index=0,
                start_slot=a.startSlot,
                end_slot=a.endSlot,
                hours=a.hours,
                is_afternoon=a.isAfternoon,
            )
            for a in rows
        ]
        assignments.extend(
            expand_collapsed_assignments(groups[synthetic_id], slices, person_id)
        )

    warnings = [
        w.model_copy(update={"taskId": groups[w.taskId].members[0].task_id})
        if w.taskId in groups
        else w
        for w in response.warnings
    ]
    return response.model_copy(update={"assignments": assignments, "warnings": warnings})
