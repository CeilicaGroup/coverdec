"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";

const updatePolicySchema = z.object({
  deviationThresholdPct: z.number().min(1).max(200),
  movingAverageSamples: z.number().int().min(1).max(500),
});

const POLICY_ID = "singleton";

export async function updateTimeDeviationPolicy(
  input: z.infer<typeof updatePolicySchema>,
) {
  return runAuditedMutation(
    "time-tracking.updateDeviationPolicy",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      const data = updatePolicySchema.parse(input);

      await prisma.timeDeviationPolicy.upsert({
        where: { id: POLICY_ID },
        create: {
          id: POLICY_ID,
          deviationThresholdPct: data.deviationThresholdPct,
          movingAverageSamples: data.movingAverageSamples,
        },
        update: {
          deviationThresholdPct: data.deviationThresholdPct,
          movingAverageSamples: data.movingAverageSamples,
        },
      });

      revalidatePath("/dashboard/desviaciones-tiempos");
    },
    {
      summary: "Actualizar política de desviación de tiempos",
      entityType: "TimeDeviationPolicy",
      entityId: POLICY_ID,
      metadata: input,
    },
  );
}
