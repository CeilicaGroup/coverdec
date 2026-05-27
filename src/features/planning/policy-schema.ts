import { z } from "zod";
import { ProjectPlanningPreset } from "@/generated/prisma";

/** Rango acotado para sliders; el solver normaliza con SCALE en Python. */
export const PLANNING_WEIGHT_MIN = 0;
export const PLANNING_WEIGHT_MAX = 5;
export const PLANNING_WEIGHT_STEP = 0.25;

export const PLANNING_STRATEGY_MAX = 100;
export const PLANNING_STRATEGY_STEP = 5;

export const planningWeightsSchema = z.object({
  wLate: z.number().min(PLANNING_WEIGHT_MIN).max(PLANNING_WEIGHT_MAX),
  wUnscheduled: z.number().min(PLANNING_WEIGHT_MIN).max(PLANNING_WEIGHT_MAX),
  wLoadBalance: z.number().min(PLANNING_WEIGHT_MIN).max(PLANNING_WEIGHT_MAX),
  wMove: z.number().min(PLANNING_WEIGHT_MIN).max(PLANNING_WEIGHT_MAX),
  wLaborCost: z.number().min(PLANNING_WEIGHT_MIN).max(PLANNING_WEIGHT_MAX),
  wPriority: z.number().min(PLANNING_WEIGHT_MIN).max(PLANNING_WEIGHT_MAX),
});

export type PlanningWeights = z.infer<typeof planningWeightsSchema>;

export const planningStrategySchema = z.object({
  deliveryPriority: z
    .number()
    .min(0)
    .max(PLANNING_STRATEGY_MAX),
  costPriority: z.number().min(0).max(PLANNING_STRATEGY_MAX),
  stability: z.number().min(0).max(PLANNING_STRATEGY_MAX).optional(),
});

export type PlanningStrategy = z.infer<typeof planningStrategySchema>;

export const projectPlanningPresetSchema = z.nativeEnum(ProjectPlanningPreset);

export const projectPlanningStrategySchema = z.object({
  preset: projectPlanningPresetSchema,
  costPriority: z.number().min(0).max(PLANNING_STRATEGY_MAX),
  stability: z.number().min(0).max(PLANNING_STRATEGY_MAX),
  deadlineBoost: z.number().min(0).max(PLANNING_STRATEGY_MAX),
});

export type ProjectPlanningStrategy = z.infer<typeof projectPlanningStrategySchema>;

export const DEFAULT_PLANNING_WEIGHTS = {
  wLate: 1,
  wUnscheduled: 1,
  wLoadBalance: 1,
  wMove: 1,
  wLaborCost: 1,
  wPriority: 0,
} as const satisfies PlanningWeights;

export const DEFAULT_PLANNING_STRATEGY = {
  deliveryPriority: 50,
  costPriority: 50,
  stability: 50,
} as const satisfies PlanningStrategy;

export const DEFAULT_PROJECT_PLANNING_STRATEGY = {
  preset: ProjectPlanningPreset.EQUILIBRADO,
  costPriority: 50,
  stability: 50,
  deadlineBoost: 50,
} as const satisfies ProjectPlanningStrategy;

/** Rellena pesos faltantes (p. ej. filas creadas antes de wLaborCost). */
export function normalizePlanningWeights(
  weights: Partial<PlanningWeights> | null | undefined,
): PlanningWeights {
  return {
    wLate: weights?.wLate ?? DEFAULT_PLANNING_WEIGHTS.wLate,
    wUnscheduled:
      weights?.wUnscheduled ?? DEFAULT_PLANNING_WEIGHTS.wUnscheduled,
    wLoadBalance:
      weights?.wLoadBalance ?? DEFAULT_PLANNING_WEIGHTS.wLoadBalance,
    wMove: weights?.wMove ?? DEFAULT_PLANNING_WEIGHTS.wMove,
    wLaborCost: weights?.wLaborCost ?? DEFAULT_PLANNING_WEIGHTS.wLaborCost,
    wPriority: weights?.wPriority ?? DEFAULT_PLANNING_WEIGHTS.wPriority,
  };
}

/**
 * Convierte prioridades 0–100 de la UI a pesos del solver HTTP (`PlanningWeights`).
 *
 * El microservicio CP-SAT los mapea internamente a `SchedulerWeights`:
 * - wUnscheduled → coverage (tier 0: asignar toda la cola)
 * - wLate → deadline (tier 1: fecha de entrega del proyecto)
 * - wLaborCost → labor_cost (tier 2)
 * - wLoadBalance → load_balance (tier 2)
 * - wMove → stability (tier 2)
 */
export function strategyToWeights(strategy: PlanningStrategy): PlanningWeights {
  const toWeight = (priority: number) =>
    (priority / PLANNING_STRATEGY_MAX) * PLANNING_WEIGHT_MAX;

  const wLate = toWeight(strategy.deliveryPriority);
  const wLaborCost = toWeight(strategy.costPriority);
  const wMove = toWeight(strategy.stability ?? DEFAULT_PLANNING_STRATEGY.stability);

  return {
    wLate,
    wUnscheduled: 5,  // Tier 0: asignar siempre toda la cola
    wLoadBalance: 1,
    wMove,
    wLaborCost,
    wPriority: toWeight(strategy.deliveryPriority),
  };
}

function toWeight(priority: number): number {
  return (priority / PLANNING_STRATEGY_MAX) * PLANNING_WEIGHT_MAX;
}

export const PROJECT_PLANNING_PRESETS = {
  [ProjectPlanningPreset.A_TIEMPO]: {
    preset: ProjectPlanningPreset.A_TIEMPO,
    costPriority: 20,
    stability: 30,
    deadlineBoost: 100,
  },
  [ProjectPlanningPreset.EQUILIBRADO]: {
    ...DEFAULT_PROJECT_PLANNING_STRATEGY,
  },
  [ProjectPlanningPreset.MIN_COSTE]: {
    preset: ProjectPlanningPreset.MIN_COSTE,
    costPriority: 90,
    stability: 70,
    deadlineBoost: 15,
  },
} as const satisfies Record<ProjectPlanningPreset, ProjectPlanningStrategy>;

export function normalizeProjectPlanningStrategy(
  strategy: Partial<ProjectPlanningStrategy> | null | undefined,
): ProjectPlanningStrategy {
  const preset = strategy?.preset ?? DEFAULT_PROJECT_PLANNING_STRATEGY.preset;
  const base = PROJECT_PLANNING_PRESETS[preset];
  return {
    preset,
    costPriority: strategy?.costPriority ?? base.costPriority,
    stability: strategy?.stability ?? base.stability,
    deadlineBoost: strategy?.deadlineBoost ?? base.deadlineBoost,
  };
}

export function projectStrategyToWeights(
  strategyInput: Partial<ProjectPlanningStrategy> | ProjectPlanningStrategy,
): PlanningWeights {
  const strategy = normalizeProjectPlanningStrategy(strategyInput);
  const base = strategyToWeights({
    deliveryPriority: strategy.deadlineBoost,
    costPriority: strategy.costPriority,
    stability: strategy.stability,
  });

  const stabilityNudge = toWeight((strategy.stability - 50) / 2 + 50);
  return normalizePlanningWeights({
    ...base,
    wPriority: Math.min(PLANNING_WEIGHT_MAX, base.wPriority + stabilityNudge * 0.2),
  });
}

/** Aproximación inversa para hidratar la UI desde pesos guardados. */
export function weightsToStrategy(
  weights: Partial<PlanningWeights> | PlanningWeights,
): PlanningStrategy {
  const w = normalizePlanningWeights(weights);
  const toPriority = (value: number) =>
    Math.round((value / PLANNING_WEIGHT_MAX) * PLANNING_STRATEGY_MAX);

  return {
    deliveryPriority: toPriority(w.wLate),
    costPriority: toPriority(w.wLaborCost),
    stability: toPriority(w.wMove),
  };
}

export const PLANNING_STRATEGY_PRESETS = {
  onTime: {
    deliveryPriority: 100,
    costPriority: 0,
    stability: 30,
  },
  balanced: { ...DEFAULT_PLANNING_STRATEGY },
  minCost: {
    deliveryPriority: 0,
    costPriority: 100,
    stability: 30,
  },
} as const satisfies Record<string, PlanningStrategy>;
