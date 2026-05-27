export type TaskProgressState = "not_started" | "in_progress" | "completed";

export interface TaskProgress {
  state: TaskProgressState;
  /** True si hay una franja real abierta (timer no terminado). */
  hasRunning: boolean;
  /** True si el avance real va por debajo del plan esperado. */
  isDelayed: boolean;
  /** Horas reales acumuladas (incluyendo la franja abierta a fecha de cálculo). */
  actualHours: number;
  /** Horas planificadas acumuladas (si aplica al contexto). */
  plannedHours: number;
}

const EPS = 0.01;

export function computeTaskProgress(input: {
  isCompleted: boolean;
  plannedHours: number;
  actualHours: number;
  hasRunning: boolean;
}): TaskProgress {
  const planned = Math.max(0, input.plannedHours);
  const actual = Math.max(0, input.actualHours);
  const hasRunning = input.hasRunning;
  const isDelayed = !input.isCompleted && planned > EPS && actual + EPS < planned;

  if (input.isCompleted) {
    return {
      state: "completed",
      hasRunning,
      isDelayed,
      plannedHours: planned,
      actualHours: actual,
    };
  }
  if (actual > EPS || hasRunning) {
    return {
      state: "in_progress",
      hasRunning,
      isDelayed,
      plannedHours: planned,
      actualHours: actual,
    };
  }
  return {
    state: "not_started",
    hasRunning,
    isDelayed,
    plannedHours: planned,
    actualHours: actual,
  };
}

