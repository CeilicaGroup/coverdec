import type { EngineAssignment } from "./engine/types";

export interface TaskWorkerConflict {
  taskId: string;
  personIds: string[];
}

export interface WorkOrderWorkerConflict {
  workOrderId: string;
  workOrderNumber: string;
  personIds: string[];
  taskIds: string[];
}

export function findTasksWithMultipleWorkers(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
): TaskWorkerConflict[] {
  const workersByTask = new Map<string, Set<string>>();
  for (const a of assignments) {
    const workers = workersByTask.get(a.taskId) ?? new Set();
    workers.add(a.personId);
    workersByTask.set(a.taskId, workers);
  }
  const conflicts: TaskWorkerConflict[] = [];
  for (const [taskId, personIds] of workersByTask) {
    if (personIds.size <= 1) continue;
    conflicts.push({ taskId, personIds: [...personIds].sort() });
  }
  return conflicts;
}

export function findWorkOrdersWithMultipleWorkers(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
  workOrderIdByTaskId: Map<string, string>,
  workOrderNumberById: Map<string, string> = new Map(),
): WorkOrderWorkerConflict[] {
  const byWorkOrder = new Map<string, { personIds: Set<string>; taskIds: Set<string> }>();

  for (const a of assignments) {
    const workOrderId = workOrderIdByTaskId.get(a.taskId);
    if (!workOrderId) continue;
    const entry = byWorkOrder.get(workOrderId) ?? {
      personIds: new Set<string>(),
      taskIds: new Set<string>(),
    };
    entry.personIds.add(a.personId);
    entry.taskIds.add(a.taskId);
    byWorkOrder.set(workOrderId, entry);
  }

  const conflicts: WorkOrderWorkerConflict[] = [];
  for (const [workOrderId, entry] of byWorkOrder) {
    if (entry.personIds.size <= 1) continue;
    conflicts.push({
      workOrderId,
      workOrderNumber: workOrderNumberById.get(workOrderId) ?? workOrderId,
      personIds: [...entry.personIds].sort(),
      taskIds: [...entry.taskIds].sort(),
    });
  }
  return conflicts;
}

/**
 * Per-task worker cap: the task's own requiredWorkers (chapas-style, solver-driven)
 * combined with however many distinct people already hold an isOverride assignment
 * for it (manual "elegir ejecutores de OT" override) — whichever is higher.
 */
export function buildTaskWorkerLimitMap(
  tasks: Array<{ id: string; requiredWorkers?: number }>,
  overrideSlices: Array<{ taskId: string; personId: string }> = [],
): Map<string, number> {
  const overridePersonCountByTask = new Map<string, Set<string>>();
  for (const slice of overrideSlices) {
    const set = overridePersonCountByTask.get(slice.taskId) ?? new Set<string>();
    set.add(slice.personId);
    overridePersonCountByTask.set(slice.taskId, set);
  }
  const limitByTaskId = new Map<string, number>();
  for (const task of tasks) {
    const overrideCount = overridePersonCountByTask.get(task.id)?.size ?? 0;
    limitByTaskId.set(task.id, Math.max(task.requiredWorkers ?? 1, overrideCount));
  }
  return limitByTaskId;
}

/** Per-work-order worker cap: the highest per-task cap among its tasks. */
export function buildWorkOrderWorkerLimitMap(
  limitByTaskId: Map<string, number>,
  workOrderIdByTaskId: Map<string, string>,
): Map<string, number> {
  const limitByWorkOrderId = new Map<string, number>();
  for (const [taskId, workOrderId] of workOrderIdByTaskId) {
    const taskLimit = limitByTaskId.get(taskId) ?? 1;
    limitByWorkOrderId.set(
      workOrderId,
      Math.max(limitByWorkOrderId.get(workOrderId) ?? 1, taskLimit),
    );
  }
  return limitByWorkOrderId;
}

export function assertSingleWorkerPerTask(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
  options?: { exemptTaskIds?: Set<string>; limitByTaskId?: Map<string, number> },
): void {
  const exempt = options?.exemptTaskIds ?? new Set<string>();
  const limitByTaskId = options?.limitByTaskId;
  const filtered = assignments.filter(
    (assignment) => !exempt.has(assignment.taskId),
  );
  const conflicts = findTasksWithMultipleWorkers(filtered).filter(
    (c) => c.personIds.length > (limitByTaskId?.get(c.taskId) ?? 1),
  );
  if (conflicts.length === 0) return;
  const detail = conflicts
    .map((c) => `${c.taskId} (${c.personIds.join(", ")})`)
    .join("; ");
  throw new Error(
    `El planning asigna más operarios de los permitidos a una tarea: ${detail}`,
  );
}

export function assertSingleWorkerPerWorkOrder(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
  workOrderIdByTaskId: Map<string, string>,
  workOrderNumberById: Map<string, string> = new Map(),
  options?: { limitByWorkOrderId?: Map<string, number> },
): void {
  const limitByWorkOrderId = options?.limitByWorkOrderId;
  const conflicts = findWorkOrdersWithMultipleWorkers(
    assignments,
    workOrderIdByTaskId,
    workOrderNumberById,
  ).filter(
    (c) => c.personIds.length > (limitByWorkOrderId?.get(c.workOrderId) ?? 1),
  );
  if (conflicts.length === 0) return;

  const lines = conflicts.map(
    (c) => `· ${c.workOrderNumber}: operarios ${c.personIds.join(", ")}`,
  );
  throw new Error(
    [
      "El planning asigna tareas de la misma OT a más operarios de los permitidos.",
      ...lines,
    ].join("\n"),
  );
}
