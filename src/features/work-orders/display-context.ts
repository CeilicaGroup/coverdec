import { prisma } from "@/lib/db";
import { PlanningStatus } from "@/generated/prisma";
import { loadPrimaryWorkerByTaskIds } from "@/features/time-tracking/task-hours-derived";
import { propagateWorkOrderOwnerByTaskId } from "./planning";
import { workOrderGroupKey } from "./group-key";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
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
  | { kind: "multiple"; assignees: TaskAssigneeSummary[] }
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

  if (tasks.every((task) => task.process === IMPREVISTA_PROCESS_CODE)) {
    const first = tasks[0]!;
    return {
      kind: "single",
      elementName: first.notes?.trim() || "Imprevista",
      processCode: IMPREVISTA_PROCESS_CODE,
    };
  }

  const keys = new Set<string>();
  for (const task of tasks) {
    const key = workOrderGroupKey(task);
    if (key) keys.add(key);
  }

  if (keys.size === 0) {
    const first = tasks[0]!;
    return {
      kind: "single",
      elementName: elementTypeName(first),
      processCode: first.process,
    };
  }
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
  assigneeByTaskId: Map<string, TaskAssigneeSummary[]>,
): WorkOrderAssigneeSummary {
  const byPersonId = new Map<string, TaskAssigneeSummary>();
  for (const taskId of taskIds) {
    for (const assignee of assigneeByTaskId.get(taskId) ?? []) {
      byPersonId.set(assignee.personId, assignee);
    }
  }

  if (byPersonId.size === 0) return { kind: "none" };
  if (byPersonId.size > 1) {
    return {
      kind: "multiple",
      assignees: [...byPersonId.values()].sort((a, b) =>
        a.iniciales.localeCompare(b.iniciales, "es"),
      ),
    };
  }

  return { kind: "single", assignee: [...byPersonId.values()][0]! };
}

export async function loadAssigneeByTaskIds(
  taskIds: string[],
): Promise<Map<string, TaskAssigneeSummary[]>> {
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

  // A task may have several distinct people (e.g. requiredWorkers>1, or a
  // manually chosen 2nd executor) — keep every distinct person seen, not
  // just the first row.
  const assigneeByTaskId = new Map<string, TaskAssigneeSummary[]>();
  for (const row of publishedAssignments) {
    const list = assigneeByTaskId.get(row.taskId) ?? [];
    if (list.some((a) => a.personId === row.personId)) continue;
    list.push({
      personId: row.personId,
      label: row.person.user?.name ?? row.person.iniciales,
      iniciales: row.person.iniciales,
    });
    assigneeByTaskId.set(row.taskId, list);
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
    assigneeByTaskId.set(taskId, [
      {
        personId: person.id,
        label: person.user?.name ?? person.iniciales,
        iniciales: person.iniciales,
      },
    ]);
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

  const ownerIds = propagateWorkOrderOwnerByTaskId(
    tasks,
    new Map(
      [...assigneeByTaskId.entries()].map(([id, list]) => [id, list[0]!.personId]),
    ),
  );

  for (const task of tasks) {
    const personId = ownerIds.get(task.id);
    if (!personId) continue;
    const existing = assigneeByTaskId.get(task.id);
    if (existing?.some((a) => a.personId === personId)) continue;
    const source =
      existing?.[0] ??
      [...assigneeByTaskId.values()]
        .flat()
        .find((a) => a.personId === personId);
    if (!source) continue;
    assigneeByTaskId.set(task.id, [source]);
  }

  return assigneeByTaskId;
}
