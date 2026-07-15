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

export function assertSingleWorkerPerTask(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
  options?: { exemptTaskIds?: Set<string> },
): void {
  const exempt = options?.exemptTaskIds ?? new Set<string>();
  const filtered = assignments.filter(
    (assignment) => !exempt.has(assignment.taskId),
  );
  const conflicts = findTasksWithMultipleWorkers(filtered);
  if (conflicts.length === 0) return;
  const detail = conflicts
    .map((c) => `${c.taskId} (${c.personIds.join(", ")})`)
    .join("; ");
  throw new Error(
    `El planning asigna la misma tarea a más de un operario: ${detail}`,
  );
}

export function assertSingleWorkerPerWorkOrder(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
  workOrderIdByTaskId: Map<string, string>,
  workOrderNumberById: Map<string, string> = new Map(),
): void {
  const conflicts = findWorkOrdersWithMultipleWorkers(
    assignments,
    workOrderIdByTaskId,
    workOrderNumberById,
  );
  if (conflicts.length === 0) return;

  const lines = conflicts.map(
    (c) => `· ${c.workOrderNumber}: operarios ${c.personIds.join(", ")}`,
  );
  throw new Error(
    [
      "El planning asigna tareas de la misma OT a operarios distintos.",
      "Todas las tareas de una OT deben ir al mismo operario:",
      ...lines,
    ].join("\n"),
  );
}
