"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { getMondayOf, isoWeek } from "@/lib/week";
import {
  generatePlanning,
  hasFuturePlannings,
  publishPlanning,
  undoPlanning,
} from "@/features/planning/service";
import type { PlanFrom } from "@/features/planning/plan-from";
import { Role } from "@/generated/prisma";

const planFromSchema = z.enum(["WEEK_START", "TODAY", "TOMORROW", "NOW"]);

const generateSchema = z.object({
  weekStart: z.string().min(8),
  planFrom: planFromSchema.default("WEEK_START"),
});

export async function generatePlanningAction(input: {
  weekStart: string;
  planFrom?: string;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { weekStart, planFrom } = generateSchema.parse(input);
  const result = await generatePlanning({
    empresaId: ctx.empresaId,
    weekStart: new Date(weekStart),
    replaceDraft: true,
    planFrom: planFrom as PlanFrom,
    planFromAt: new Date(),
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

const undoSchema = z.object({ weekStart: z.string().min(8) });

export async function undoPlanningAction(input: { weekStart: string }) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { weekStart } = undoSchema.parse(input);
  await undoPlanning({
    empresaId: ctx.empresaId,
    weekStart: new Date(weekStart),
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function getPlanningUndoState(weekStartIso: string): Promise<{
  canUndo: boolean;
  hasFuturePlannings: boolean;
  isPublished: boolean;
}> {
  const ctx = await requireDashboardContext();
  const weekStart = getMondayOf(new Date(weekStartIso));
  const { year, week } = isoWeek(weekStart);

  const planning = await prisma.planning.findUnique({
    where: {
      empresaId_year_week: { empresaId: ctx.empresaId, year, week },
    },
  });
  if (!planning) {
    return { canUndo: false, hasFuturePlannings: false, isPublished: false };
  }

  const future = await hasFuturePlannings(ctx.empresaId, weekStart);
  return {
    canUndo: !future,
    hasFuturePlannings: future,
    isPublished: planning.status === "PUBLISHED",
  };
}
