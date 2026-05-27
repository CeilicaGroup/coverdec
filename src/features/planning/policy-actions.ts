"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { Role } from "@/generated/prisma";
import {
  planningStrategySchema,
  PLANNING_STRATEGY_MAX,
  planningWeightsSchema,
  strategyToWeights,
} from "@/features/planning/policy-schema";

const log = childLogger({ module: "planning.policy-actions" });

export async function savePlanningWeightsAction(
  input: unknown,
): Promise<{ ok: true }> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = planningWeightsSchema.parse(input);

  if (!ctx.naveId) throw new Error("Selecciona una nave antes de configurar el planning");

  await prisma.planningPolicy.upsert({
    where: { naveId: ctx.naveId },
    create: {
      naveId: ctx.naveId,
      wLate: data.wLate,
      wUnscheduled: data.wUnscheduled,
      wLoadBalance: data.wLoadBalance,
      wMove: data.wMove,
      wLaborCost: data.wLaborCost,
      wPriority: data.wPriority,
    },
    update: {
      wLate: data.wLate,
      wUnscheduled: data.wUnscheduled,
      wLoadBalance: data.wLoadBalance,
      wMove: data.wMove,
      wLaborCost: data.wLaborCost,
      wPriority: data.wPriority,
    },
  });

  log.info({ naveId: ctx.naveId }, "planning weights saved");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Guarda estrategia (0–100) mapeada a pesos del solver en servidor. */
export async function savePlanningStrategyAction(
  input: unknown,
): Promise<{ ok: true }> {
  const strategy = planningStrategySchema.parse(input);
  const weights = strategyToWeights(strategy);
  return savePlanningWeightsAction(weights);
}

const nonlinearDeadlineSettingsSchema = z.object({
  deadlineCurveExponent: z.number().min(1).max(4),
  overduePenaltyMultiplier: z.number().min(1).max(8),
  globalDeadlineBoost: z.number().min(0).max(PLANNING_STRATEGY_MAX),
});

export async function saveNonlinearDeadlineSettingsAction(
  input: unknown,
): Promise<{ ok: true }> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = nonlinearDeadlineSettingsSchema.parse(input);

  if (!ctx.naveId) throw new Error("Selecciona una nave antes de configurar el planning");

  const strategyWeights = strategyToWeights({
    deliveryPriority: data.globalDeadlineBoost,
    costPriority: 50,
    stability: 50,
  });

  await prisma.planningPolicy.upsert({
    where: { naveId: ctx.naveId },
    create: {
      naveId: ctx.naveId,
      wLate: strategyWeights.wLate,
      wUnscheduled: strategyWeights.wUnscheduled,
      wLoadBalance: strategyWeights.wLoadBalance,
      wMove: strategyWeights.wMove,
      wLaborCost: strategyWeights.wLaborCost,
      wPriority: strategyWeights.wPriority,
      deadlineCurveExponent: data.deadlineCurveExponent,
      overduePenaltyMultiplier: data.overduePenaltyMultiplier,
    },
    update: {
      wPriority: strategyWeights.wPriority,
      deadlineCurveExponent: data.deadlineCurveExponent,
      overduePenaltyMultiplier: data.overduePenaltyMultiplier,
    },
  });

  log.info(
    {
      naveId: ctx.naveId,
      deadlineCurveExponent: data.deadlineCurveExponent,
      overduePenaltyMultiplier: data.overduePenaltyMultiplier,
      globalDeadlineBoost: data.globalDeadlineBoost,
    },
    "planning nonlinear deadline settings saved",
  );
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
