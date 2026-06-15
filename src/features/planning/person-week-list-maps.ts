import type { ProgressStripe } from "@/components/task-progress";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import type { ActualHourEntry } from "@/features/planning/queries";
import type { PlanningAssignmentSlice } from "@/features/planning/planning-timeline";
import { formatHours, formatShortDate } from "@/lib/format";
import type { PersonWeekListMaps } from "./person-week-list";

export function buildPersonWeekListMaps(
  planningAssignments: PlanningAssignmentSlice[],
  actualEntries: ActualHourEntry[],
  todayIso: string,
): PersonWeekListMaps {
  return {
    plannedByTask: buildHoursByTaskFromPlan(planningAssignments),
    plannedDueByTask: buildDueHoursByTaskFromPlan(planningAssignments, todayIso),
    actualByTask: buildHoursByTaskFromActual(actualEntries),
    completedByTask: buildCompletedByTask(planningAssignments, actualEntries),
    plannedItemsByTask: buildItemsByTaskFromPlan(planningAssignments),
  };
}

function buildHoursByTaskFromPlan(assignments: PlanningAssignmentSlice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    map.set(assignment.task.id, (map.get(assignment.task.id) ?? 0) + assignment.hours);
  }
  return map;
}

function buildDueHoursByTaskFromPlan(
  assignments: PlanningAssignmentSlice[],
  cutoffIso: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.date.toISOString().slice(0, 10) > cutoffIso) continue;
    map.set(assignment.task.id, (map.get(assignment.task.id) ?? 0) + assignment.hours);
  }
  return map;
}

function buildHoursByTaskFromActual(entries: ActualHourEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.taskId) continue;
    map.set(entry.taskId, (map.get(entry.taskId) ?? 0) + entry.hours);
  }
  return map;
}

function buildItemsByTaskFromPlan(
  assignments: PlanningAssignmentSlice[],
): Map<string, ProgressStripe[]> {
  const map = new Map<string, ProgressStripe[]>();
  for (const assignment of assignments) {
    const list = map.get(assignment.task.id) ?? [];
    list.push({
      id: assignment.id,
      label: `${formatShortDate(assignment.date)} · ${rangeLabel(
        assignment.startSlot,
        assignment.endSlot,
      )} · ${formatHours(assignment.hours)}`,
      kind: "plan",
    });
    map.set(assignment.task.id, list);
  }
  return map;
}

function buildCompletedByTask(
  assignments: PlanningAssignmentSlice[],
  entries: ActualHourEntry[],
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const assignment of assignments) {
    map.set(assignment.task.id, assignment.task.isCompleted);
  }
  for (const entry of entries) {
    if (!entry.taskId || !entry.task) continue;
    map.set(entry.taskId, entry.task.isCompleted);
  }
  return map;
}
