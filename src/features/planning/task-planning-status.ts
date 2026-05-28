export interface TaskPlanningHours {
  pendingToPlanHours: number;
  remainingWorkHours: number;
  estimatedHours: number;
  isCompleted?: boolean;
}

/** Tarea cerrada para el motor de planning (no generar ni reconciliar cola). */
export function isTaskClosedForPlanning(task: TaskPlanningHours): boolean {
  if (task.isCompleted) return true;
  if (task.pendingToPlanHours <= 1e-6) return true;
  return task.remainingWorkHours <= 1e-6;
}

/** Horas que el solver debe cubrir derivadas de registros + planning previo. */
export function effectivePendingHours(
  task: TaskPlanningHours,
  options?: { priorPlannedHours?: number },
): number {
  if (isTaskClosedForPlanning(task)) return 0;
  let cap = Math.max(0, task.remainingWorkHours);
  if (options?.priorPlannedHours != null) {
    cap = Math.min(cap, Math.max(0, task.remainingWorkHours - options.priorPlannedHours));
  }
  return Math.min(Math.max(0, task.pendingToPlanHours), cap);
}
