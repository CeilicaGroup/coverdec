"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { getMondayOf, isoWeek } from "@/lib/week";
import {
  generatePlanning,
  hasFuturePlannings,
  hasRegistrosFromWeek,
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
  if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");
  const { weekStart, planFrom } = generateSchema.parse(input);
  const result = await generatePlanning({
    naveId: ctx.naveId,
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
  if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");
  const { planningId } = publishSchema.parse(input);
  const planning = await prisma.planning.findUnique({ where: { id: planningId }, select: { naveId: true } });
  if (!planning || planning.naveId !== ctx.naveId) throw new Error("No autorizado");
  await publishPlanning(planningId);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

const undoSchema = z.object({ weekStart: z.string().min(8) });

export async function undoPlanningAction(input: { weekStart: string }) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");
  const { weekStart } = undoSchema.parse(input);
  await undoPlanning({
    naveId: ctx.naveId,
    weekStart: new Date(weekStart),
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function getPlanningUndoState(weekStartIso: string): Promise<{
  canUndo: boolean;
  hasFuturePlannings: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
}> {
  const ctx = await requireDashboardContext();
  if (!ctx.naveId) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      hasRegistros: false,
      isPublished: false,
    };
  }
  const weekStart = getMondayOf(new Date(weekStartIso));
  const { year, week } = isoWeek(weekStart);

  const planning = await prisma.planning.findUnique({
    where: {
      naveId_year_week: { naveId: ctx.naveId, year, week },
    },
  });
  if (!planning) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      hasRegistros: false,
      isPublished: false,
    };
  }

  const [future, registros] = await Promise.all([
    hasFuturePlannings(ctx.naveId, weekStart),
    hasRegistrosFromWeek(ctx.naveId, weekStart),
  ]);
  return {
    canUndo: !future && !registros,
    hasFuturePlannings: future,
    hasRegistros: registros,
    isPublished: planning.status === "PUBLISHED",
  };
}
