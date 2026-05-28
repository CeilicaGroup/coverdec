export interface TaskPlanningHours {
  pendingHours: number;
  doneHours: number;
  estimatedHours: number;
  isCompleted?: boolean;
}

/** Tarea cerrada para el motor de planning (no generar ni reconciliar cola). */
export function isTaskClosedForPlanning(task: TaskPlanningHours): boolean {
  if (task.isCompleted) return true;
  if (task.pendingHours <= 0) return true;
  if (
    task.estimatedHours > 0 &&
    task.doneHours >= task.estimatedHours - 1e-6
  ) {
    return true;
  }
  return false;
}

/** Horas que el solver debe cubrir (pendingHours ya viene reconciliado por semana). */
export function effectivePendingHours(
  task: TaskPlanningHours,
  options?: { priorPlannedHours?: number },
): number {
  if (isTaskClosedForPlanning(task)) return 0;
  const remaining = Math.max(0, task.estimatedHours - task.doneHours);
  let cap = remaining;
  if (options?.priorPlannedHours != null) {
    cap = Math.min(cap, Math.max(0, remaining - options.priorPlannedHours));
  }
  return Math.min(Math.max(0, task.pendingHours), cap);
}
