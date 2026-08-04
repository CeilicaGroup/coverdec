import { formatPlanningWarningMessages } from "@/features/planning/format-warnings";
import type { SolverInfeasibleError } from "@/features/planning/engine/solver-types";

const WEEKDAY_LABELS = ["lunes", "martes", "miércoles", "jueves", "viernes"] as const;

export class PlanningGenerationError extends Error {
  readonly summary: string;
  readonly warnings: string[];
  readonly unscheduledHours: number;

  constructor(args: {
    summary: string;
    warnings?: string[];
    unscheduledHours?: number;
  }) {
    super(args.summary);
    this.name = "PlanningGenerationError";
    this.summary = args.summary;
    this.warnings = args.warnings ?? [];
    this.unscheduledHours = args.unscheduledHours ?? 0;
  }
}

export function isPlanningGenerationError(
  err: unknown,
): err is PlanningGenerationError {
  return err instanceof PlanningGenerationError;
}

/** Convierte errores multi-línea del solver en summary + avisos. */
export function planningErrorFromMessage(
  message: string,
  unscheduledHours = 0,
): PlanningGenerationError {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return new PlanningGenerationError({
      summary: lines[0] ?? "No se ha podido generar planning.",
      unscheduledHours,
    });
  }
  return new PlanningGenerationError({
    summary: lines[0]!,
    warnings: lines.slice(1),
    unscheduledHours,
  });
}

function schedulableWindowHint(firstSchedulableDayIndex: number | undefined): string {
  if (
    firstSchedulableDayIndex == null ||
    firstSchedulableDayIndex <= 0 ||
    firstSchedulableDayIndex >= WEEKDAY_LABELS.length
  ) {
    return "";
  }
  const dayLabel = WEEKDAY_LABELS[firstSchedulableDayIndex] ?? "ese día";
  const remaining = WEEKDAY_LABELS.length - firstSchedulableDayIndex;
  if (remaining === 1) {
    return (
      ` Solo queda 1 día planificable (${dayLabel}) por «Planificar desde».` +
      " Elige el lunes u otra semana, o amplía la fecha de inicio."
    );
  }
  return (
    ` Solo quedan ${remaining} días planificables (desde ${dayLabel}) por «Planificar desde».` +
    " Amplía la fecha de inicio si necesitas más capacidad esta semana."
  );
}

export function buildUnscheduledPlanningSummary(args: {
  totalUnplaced: number;
  warningCount: number;
  deferredHours: number;
  firstSchedulableDayIndex?: number;
}): string {
  const deferredSummary =
    args.deferredHours > 0
      ? ` Además, ${args.deferredHours.toFixed(1)}h quedaron aplazadas por secado/cadena.`
      : "";
  const windowHint = schedulableWindowHint(args.firstSchedulableDayIndex);

  return (
    `No se ha podido generar planning: capacidad insuficiente` +
    ` (${args.totalUnplaced.toFixed(1)}h sin asignar en ${args.warningCount} tarea(s)).` +
    windowHint +
    deferredSummary +
    (windowHint
      ? ""
      : " Revisa capacidad, especialidades, bloqueos de secado y fecha de inicio de planificación.")
  );
}

export async function planningErrorFromSolverInfeasible(
  err: SolverInfeasibleError,
): Promise<PlanningGenerationError> {
  if (err.warnings.length > 0) {
    const formatted = await formatPlanningWarningMessages(err.warnings);
    return new PlanningGenerationError({
      summary: err.message,
      warnings: formatted,
    });
  }
  return planningErrorFromMessage(err.message);
}

export async function buildUnscheduledPlanningFailure(args: {
  totalUnplaced: number;
  deferredHours: number;
  warnings: { taskId: string; reason: string }[];
  firstSchedulableDayIndex?: number;
}): Promise<PlanningGenerationError> {
  const formatted = await formatPlanningWarningMessages(args.warnings);
  return new PlanningGenerationError({
    summary: buildUnscheduledPlanningSummary({
      totalUnplaced: args.totalUnplaced,
      warningCount: args.warnings.length,
      deferredHours: args.deferredHours,
      firstSchedulableDayIndex: args.firstSchedulableDayIndex,
    }),
    warnings: formatted,
    unscheduledHours: args.totalUnplaced,
  });
}
