"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { generatePlanning, publishPlanning } from "@/features/planning/service";
import { Role } from "@/generated/prisma";

const generateSchema = z.object({
  weekStart: z.string().min(8),
});

export async function generatePlanningAction(input: { weekStart: string }) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { weekStart } = generateSchema.parse(input);
  const result = await generatePlanning({
    empresaId: ctx.empresaId,
    weekStart: new Date(weekStart),
    replaceDraft: true,
  });
  revalidatePath("/dashboard", "layout");
  return result;
}

const publishSchema = z.object({ planningId: z.string().min(1) });

export async function publishPlanningAction(input: { planningId: string }) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { planningId } = publishSchema.parse(input);
  await publishPlanning(planningId);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
