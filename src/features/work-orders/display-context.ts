import { prisma } from "@/lib/db";
import { PlanningStatus } from "@/generated/prisma";
import { loadPrimaryWorkerByTaskIds } from "@/features/time-tracking/task-hours-derived";
import { propagateWorkOrderOwnerByTaskId } from "./planning";
import { workOrderGroupKey } from "./group-key";
import type { WorkOrderTaskFilterable } from "./filter-tasks";

export interface TaskAssigneeSummary {
  personId: string;
  label: string;
  iniciales: string;
}

export type WorkOrderElementProcessSummary =
  | { kind: "single"; elementName: string; processCode: string }
  | { kind: "multiple"; count: number }
  | { kind: "unknown" };

export type WorkOrderAssigneeSummary =
  | { kind: "single"; assignee: TaskAssigneeSummary }
  | { kind: "multiple" }
  | { kind: "none" };

function elementTypeName(task: WorkOrderTaskFilterable): string {
  return (
    task.lampElement?.elementType.name ??
    task.lamp.elementType?.name ??
    "—"
  );
}

export function summarizeWorkOrderElementProcess(
  tasks: WorkOrderTaskFilterable[],
): WorkOrderElementProcessSummary {
  if (tasks.length === 0) return { kind: "unknown" };

  const keys = new Set<string>();
  for (const task of tasks) {
    const key = workOrderGroupKey(task);
    if (key) keys.add(key);
  }

  if (keys.size === 0) return { kind: "unknown" };
  if (keys.size > 1) return { kind: "multiple", count: keys.size };

  const first = tasks.find((t) => workOrderGroupKey(t) !== null);
  if (!first) return { kind: "unknown" };

  return {
    kind: "single",
    elementName: elementTypeName(first),
    processCode: first.process,
  };
}

export function summarizeWorkOrderAssignee(
  taskIds: string[],
  assigneeByTaskId: Map<string, TaskAssigneeSummary>,
): WorkOrderAssigneeSummary {
  const personIds = new Set<string>();
  for (const taskId of taskIds) {
    const assignee = assigneeByTaskId.get(taskId);
    if (assignee) personIds.add(assignee.personId);
  }

  if (personIds.size === 0) return { kind: "none" };
  if (personIds.size > 1) return { kind: "multiple" };

  const personId = [...personIds][0]!;
  const assignee = [...assigneeByTaskId.values()].find(
    (a) => a.personId === personId,
  );
  if (!assignee) return { kind: "none" };
  return { kind: "single", assignee };
}

export async function loadAssigneeByTaskIds(
  taskIds: string[],
): Promise<Map<string, TaskAssigneeSummary>> {
  if (taskIds.length === 0) return new Map();

  const publishedAssignments = await prisma.planningAssignment.findMany({
    where: {
      taskId: { in: taskIds },
      planning: { status: PlanningStatus.PUBLISHED },
    },
    select: {
      taskId: true,
      personId: true,
      date: true,
      endSlot: true,
      person: {
        select: {
          id: true,
          iniciales: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "desc" }, { endSlot: "desc" }],
  });

  const assigneeByTaskId = new Map<string, TaskAssigneeSummary>();
  for (const row of publishedAssignments) {
    if (assigneeByTaskId.has(row.taskId)) continue;
    assigneeByTaskId.set(row.taskId, {
      personId: row.personId,
      label: row.person.user?.name ?? row.person.iniciales,
      iniciales: row.person.iniciales,
    });
  }

  const missingTaskIds = taskIds.filter((id) => !assigneeByTaskId.has(id));
  if (missingTaskIds.length === 0) return assigneeByTaskId;

  const primaryWorkerByTask = await loadPrimaryWorkerByTaskIds(
    prisma,
    missingTaskIds,
  );
  const personIds = [...new Set(primaryWorkerByTask.values())];
  if (personIds.length === 0) return assigneeByTaskId;

  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: {
      id: true,
      iniciales: true,
      user: { select: { name: true } },
    },
  });
  const personById = new Map(people.map((p) => [p.id, p]));

  for (const taskId of missingTaskIds) {
    const personId = primaryWorkerByTask.get(taskId);
    if (!personId) continue;
    const person = personById.get(personId);
    if (!person) continue;
    assigneeByTaskId.set(taskId, {
      personId: person.id,
      label: person.user?.name ?? person.iniciales,
      iniciales: person.iniciales,
    });
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      workOrderId: true,
      workOrderSequence: true,
      workOrder: { select: { status: true } },
    },
  });

  const ownerIds = propagateWorkOrderOwnerByTaskId(tasks, new Map(
    [...assigneeByTaskId.entries()].map(([id, a]) => [id, a.personId]),
  ));

  for (const task of tasks) {
    const personId = ownerIds.get(task.id);
    if (!personId) continue;
    const existing = assigneeByTaskId.get(task.id);
    if (existing?.personId === personId) continue;
    const source =
      existing ??
      [...assigneeByTaskId.values()].find((a) => a.personId === personId);
    if (!source) continue;
    assigneeByTaskId.set(task.id, source);
  }

  return assigneeByTaskId;
}
