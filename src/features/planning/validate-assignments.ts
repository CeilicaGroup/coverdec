import type { EngineAssignment } from "./engine/types";

export interface TaskWorkerConflict {
  taskId: string;
  personIds: string[];
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

export function assertSingleWorkerPerTask(
  assignments: Pick<EngineAssignment, "taskId" | "personId">[],
): void {
  const conflicts = findTasksWithMultipleWorkers(assignments);
  if (conflicts.length === 0) return;
  const detail = conflicts
    .map((c) => `${c.taskId} (${c.personIds.join(", ")})`)
    .join("; ");
  throw new Error(
    `El planning asigna la misma tarea a más de un operario: ${detail}`,
  );
}
