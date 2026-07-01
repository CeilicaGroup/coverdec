"""Collapse multi-task work orders into one synthetic task for the CP-SAT model."""

from __future__ import annotations

from dataclasses import dataclass

from app.model.candidates import pick_candidates
from app.model.timeline import AFTERNOON_UI_OFFSET, DailyAssignmentSlice
from app.schemas import EngineAssignment, EnginePerson, EngineTask

WO_SYNTHETIC_PREFIX = "__wo__:"


@dataclass(frozen=True)
class WoMember:
    task_id: str
    pending_hours: float
    process: str


@dataclass(frozen=True)
class WoCollapseGroup:
    synthetic_id: str
    work_order_id: str
    members: tuple[WoMember, ...]


def synthetic_task_id(work_order_id: str) -> str:
    return f"{WO_SYNTHETIC_PREFIX}{work_order_id}"


def _intersect_candidate_ids(
    people: list[EnginePerson],
    processes: list[str],
) -> set[str]:
    if not processes:
        return set()
    common: set[str] | None = None
    for process in processes:
        ids = {person.id for person in pick_candidates(people, process)}
        common = ids if common is None else common & ids
    return common or set()


def _build_synthetic_task(members: list[EngineTask], synthetic_id: str) -> EngineTask:
    template = members[0]
    return template.model_copy(
        update={
            "id": synthetic_id,
            "pendingHours": sum(member.pendingHours for member in members),
            "canFragment": all(member.canFragment for member in members),
            "minWeekQuarter": max(member.minWeekQuarter or 0 for member in members),
            "ownerPersonId": next(
                (member.ownerPersonId for member in members if member.ownerPersonId),
                None,
            ),
            "workOrderSequence": 0,
        },
    )


def collapse_work_order_tasks(
    tasks: list[EngineTask],
    people: list[EnginePerson],
    *,
    fixed_task_ids: set[str],
) -> tuple[
    list[EngineTask],
    dict[str, WoCollapseGroup],
    dict[str, list[str]],
    dict[str, str],
]:
    """
    Replace OT groups (2+ tasks) with one synthetic task when safe.

    Returns collapsed tasks, groups by synthetic id, candidate overrides, and
    member-id -> synthetic-id map.
    """
    by_wo: dict[str, list[EngineTask]] = {}
    for task in tasks:
        if task.workOrderId:
            by_wo.setdefault(task.workOrderId, []).append(task)

    groups: dict[str, WoCollapseGroup] = {}
    candidate_ids_by_task: dict[str, list[str]] = {}
    member_to_synthetic: dict[str, str] = {}
    synthetics: dict[str, EngineTask] = {}

    for wo_id, members in by_wo.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda task: task.workOrderSequence or 0)

        if any(member.id in fixed_task_ids for member in members):
            continue

        owners = {member.ownerPersonId for member in members if member.ownerPersonId}
        if len(owners) > 1:
            continue

        eligible = _intersect_candidate_ids(people, [member.process for member in members])
        if owners:
            eligible &= owners
        if not eligible:
            continue

        synthetic_id = synthetic_task_id(wo_id)
        synthetics[synthetic_id] = _build_synthetic_task(members, synthetic_id)
        groups[synthetic_id] = WoCollapseGroup(
            synthetic_id=synthetic_id,
            work_order_id=wo_id,
            members=tuple(
                WoMember(
                    task_id=member.id,
                    pending_hours=member.pendingHours,
                    process=member.process,
                )
                for member in members
            ),
        )
        candidate_ids_by_task[synthetic_id] = sorted(eligible)
        for member in members:
            member_to_synthetic[member.id] = synthetic_id

    if not synthetics:
        return tasks, {}, {}, {}

    out_tasks: list[EngineTask] = []
    for task in tasks:
        synthetic_id = member_to_synthetic.get(task.id)
        if synthetic_id is not None:
            if synthetics.get(synthetic_id) is not None:
                out_tasks.append(synthetics.pop(synthetic_id))
            continue
        out_tasks.append(task)

    return out_tasks, groups, candidate_ids_by_task, member_to_synthetic


def remap_previous_hours(
    prev_q: dict[str, int],
    groups: dict[str, WoCollapseGroup],
) -> dict[str, int]:
    if not groups:
        return prev_q

    member_ids: set[str] = set()
    for group in groups.values():
        member_ids.update(member.task_id for member in group.members)

    remapped = {
        key: value for key, value in prev_q.items() if key.split("|", 1)[0] not in member_ids
    }
    for group in groups.values():
        group_member_ids = {member.task_id for member in group.members}
        for key, quarters in prev_q.items():
            task_id, rest = key.split("|", 1)
            if task_id not in group_member_ids:
                continue
            syn_key = f"{group.synthetic_id}|{rest}"
            remapped[syn_key] = remapped.get(syn_key, 0) + quarters
    return remapped


def expand_collapsed_assignments(
    group: WoCollapseGroup,
    slices: list[DailyAssignmentSlice],
    person_id: str,
) -> list[EngineAssignment]:
    """Split one synthetic block into per-member assignments in OT sequence."""
    if not slices:
        return []

    assignments: list[EngineAssignment] = []
    slice_idx = 0
    offset_in_slice = 0.0
    remaining_assigned = sum(current.hours for current in slices)

    for member in group.members:
        if remaining_assigned <= 1e-6:
            break
        need = min(member.pending_hours, remaining_assigned)
        while need > 1e-6 and slice_idx < len(slices):
            current = slices[slice_idx]
            available = current.hours - offset_in_slice
            take = min(available, need)
            if take > 1e-6:
                start_slot = current.start_slot + offset_in_slice
                assignments.append(
                    EngineAssignment(
                        taskId=member.task_id,
                        personId=person_id,
                        date=current.day,
                        startSlot=start_slot,
                        endSlot=start_slot + take,
                        hours=take,
                        process=member.process,
                        isAfternoon=start_slot >= AFTERNOON_UI_OFFSET,
                    ),
                )
                need -= take
                remaining_assigned -= take
                offset_in_slice += take
            if offset_in_slice >= current.hours - 1e-6:
                slice_idx += 1
                offset_in_slice = 0.0

    return assignments


def expand_unscheduled_warning(
    group: WoCollapseGroup,
    unscheduled_hours: float,
) -> list[tuple[str, float]]:
    """Distribute leftover hours across members by pending share."""
    total_pending = sum(member.pending_hours for member in group.members)
    if total_pending <= 0:
        return [(group.members[0].task_id, unscheduled_hours)]

    remaining = unscheduled_hours
    out: list[tuple[str, float]] = []
    for index, member in enumerate(group.members):
        if index == len(group.members) - 1:
            share = remaining
        else:
            share = unscheduled_hours * (member.pending_hours / total_pending)
            remaining -= share
        if share > 1e-6:
            out.append((member.task_id, share))
    return out


def display_task_id(
    task_id: str,
    wo_collapse: dict[str, WoCollapseGroup],
) -> str:
    group = wo_collapse.get(task_id)
    if group is None:
        return task_id
    return group.members[0].task_id
