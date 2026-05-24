"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { Role } from "@/generated/prisma";
import {
  planningStrategySchema,
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

  await prisma.planningPolicy.upsert({
    where: { empresaId: ctx.empresaId },
    create: {
      empresaId: ctx.empresaId,
      wLate: data.wLate,
      wUnscheduled: data.wUnscheduled,
      wLoadBalance: data.wLoadBalance,
      wMove: data.wMove,
      wLaborCost: data.wLaborCost,
    },
    update: {
      wLate: data.wLate,
      wUnscheduled: data.wUnscheduled,
      wLoadBalance: data.wLoadBalance,
      wMove: data.wMove,
      wLaborCost: data.wLaborCost,
    },
  });

  log.info({ empresaId: ctx.empresaId }, "planning weights saved");
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
