/** Cuarters en el horizonte del solver (5 días × 96 cuartos/día). */
export const PLANNING_HORIZON_DAYS = 5;
export const PLANNING_HORIZON_QUARTERS = PLANNING_HORIZON_DAYS * 24 * 4;

export interface WeekProgressInput {
  estimatedHours: number;
  doneHours: number;
  priorPlannedHours: number;
  assignedThisWeekHours: number;
}

export interface WeekTaskMetrics {
  totalEstimatedHours: number;
  doneHours: number;
  priorPlannedHours: number;
  assignedThisWeekHours: number;
  pendingHours: number;
  /** Carga de planificación de esta semana: pendiente + asignado en la semana. */
  weekScopeHours: number;
  remainingWorkHours: number;
}

export function computeWeekTaskMetrics(task: {
  estimatedHours: number;
  doneHours: number;
  priorPlannedHours: number;
  assignedThisWeekHours: number;
  pendingHours: number;
}): WeekTaskMetrics {
  const pendingHours = Math.max(0, task.pendingHours);
  const assignedThisWeekHours = Math.max(0, task.assignedThisWeekHours);
  return {
    totalEstimatedHours: task.estimatedHours,
    doneHours: task.doneHours,
    priorPlannedHours: Math.max(0, task.priorPlannedHours),
    assignedThisWeekHours,
    pendingHours,
    weekScopeHours: pendingHours + assignedThisWeekHours,
    remainingWorkHours: Math.max(0, task.estimatedHours - task.doneHours),
  };
}

export function aggregateWeekTaskMetrics(
  items: WeekTaskMetrics[],
): Pick<
  WeekTaskMetrics,
  | "weekScopeHours"
  | "pendingHours"
  | "assignedThisWeekHours"
  | "priorPlannedHours"
  | "remainingWorkHours"
  | "totalEstimatedHours"
  | "doneHours"
> {
  return {
    totalEstimatedHours: items.reduce((a, i) => a + i.totalEstimatedHours, 0),
    doneHours: items.reduce((a, i) => a + i.doneHours, 0),
    priorPlannedHours: items.reduce((a, i) => a + i.priorPlannedHours, 0),
    assignedThisWeekHours: items.reduce(
      (a, i) => a + i.assignedThisWeekHours,
      0,
    ),
    pendingHours: items.reduce((a, i) => a + i.pendingHours, 0),
    weekScopeHours: items.reduce((a, i) => a + i.weekScopeHours, 0),
    remainingWorkHours: items.reduce((a, i) => a + i.remainingWorkHours, 0),
  };
}

export interface WeekProgress {
  estimatedHours: number;
  doneHours: number;
  priorPlannedHours: number;
  assignedThisWeekHours: number;
  /** % del estimado ya realizado (fichajes + tareas completadas). */
  donePct: number;
  /** % adicional planificado en semanas anteriores. */
  priorPlannedPct: number;
  /** % adicional planificado en la semana visible. */
  weekPlannedPct: number;
  /** Avance al inicio de la semana vista (hecho + planificado en semanas anteriores). */
  progressBasePct: number;
  /** Avance tras incluir el planning de esta semana. */
  progressEndPct: number;
}

function hoursToPct(hours: number, estimatedHours: number): number {
  if (estimatedHours <= 1e-6) return 0;
  return Math.round((hours / estimatedHours) * 100);
}

export function computeWeekProgress(input: WeekProgressInput): WeekProgress {
  const estimatedHours = Math.max(0, input.estimatedHours);
  const doneHours = Math.max(0, input.doneHours);
  const priorPlannedHours = Math.max(0, input.priorPlannedHours);
  const assignedThisWeekHours = Math.max(0, input.assignedThisWeekHours);

  if (estimatedHours <= 1e-6) {
    return {
      estimatedHours,
      doneHours,
      priorPlannedHours,
      assignedThisWeekHours,
      donePct: 0,
      priorPlannedPct: 0,
      weekPlannedPct: 0,
      progressBasePct: 0,
      progressEndPct: 0,
    };
  }

  const doneSeg = Math.min(estimatedHours, doneHours);
  const priorSeg = Math.min(estimatedHours - doneSeg, priorPlannedHours);
  const weekSeg = Math.min(
    estimatedHours - doneSeg - priorSeg,
    assignedThisWeekHours,
  );
  const baseHours = doneSeg + priorSeg;
  const endHours = baseHours + weekSeg;

  return {
    estimatedHours,
    doneHours,
    priorPlannedHours,
    assignedThisWeekHours,
    donePct: hoursToPct(doneSeg, estimatedHours),
    priorPlannedPct: hoursToPct(priorSeg, estimatedHours),
    weekPlannedPct: hoursToPct(weekSeg, estimatedHours),
    progressBasePct: hoursToPct(baseHours, estimatedHours),
    progressEndPct: hoursToPct(endHours, estimatedHours),
  };
}

export function aggregateWeekProgress(
  items: WeekProgressInput[],
): WeekProgress {
  return computeWeekProgress({
    estimatedHours: items.reduce((a, i) => a + i.estimatedHours, 0),
    doneHours: items.reduce((a, i) => a + i.doneHours, 0),
    priorPlannedHours: items.reduce((a, i) => a + i.priorPlannedHours, 0),
    assignedThisWeekHours: items.reduce((a, i) => a + i.assignedThisWeekHours, 0),
  });
}

/** Tarea/proceso que aún debe entrar en el planning de esta o siguientes semanas. */
export function taskHasRemainingToPlan(task: {
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  isCompleted?: boolean;
}): boolean {
  if (task.isCompleted) return false;
  if (
    task.estimatedHours > 0 &&
    task.doneHours >= task.estimatedHours - 1e-6
  ) {
    return false;
  }
  return task.pendingHours > 1e-6;
}

/** Visible en el Gantt de una semana: pendiente de planificar o con asignación en esa semana. */
export function taskVisibleInGanttWeek(
  task: {
    estimatedHours: number;
    doneHours: number;
    pendingHours: number;
  },
  assignedThisWeekHours: number,
): boolean {
  if (assignedThisWeekHours > 1e-6) return true;
  return taskHasRemainingToPlan(task);
}
