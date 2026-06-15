"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { getMondayOf, isoWeek } from "@/lib/week";
import {
  generatePlanning,
  hasRegistrosFromWeek,
  listFuturePlannings,
  publishPlanning,
  undoPlanning,
} from "@/features/planning/service";
import {
  addWeeks,
  clearFutureDraftPlannings,
  countPendingPlanningHours,
  hasPublishedFuturePlannings,
  isMultiWeekMode,
  relevantPendingHours,
  shouldContinueHorizon,
} from "@/features/planning/planning-horizon";
import { planningHorizonModeSchema } from "@/features/planning/planning-horizon-schema";
import { Role } from "@/generated/prisma";

const generateSchema = z.object({
  weekStart: z.string().min(8),
  horizonMode: planningHorizonModeSchema,
});

export async function generatePlanningAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");
  const { weekStart, horizonMode } = generateSchema.parse(input);
  const result = await generatePlanning({
    naveId: ctx.naveId,
    weekStart: new Date(weekStart),
    replaceDraft: true,
    planFrom: "WEEK_START",
    planFromAt: new Date(),
  });
  revalidatePath("/dashboard", "layout");
  return result;
}

export async function prepareHorizonGenerationAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");

  const { weekStart, horizonMode } = generateSchema.parse(input);
  const anchor = getMondayOf(new Date(weekStart));

  if (isMultiWeekMode(horizonMode)) {
    if (await hasPublishedFuturePlannings(ctx.naveId, anchor)) {
      throw new Error(
        "Hay plannings publicados en semanas posteriores. Deshaz o regenera esas semanas primero.",
      );
    }
    await clearFutureDraftPlannings(ctx.naveId, anchor);
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function getPlanningHorizonProgressAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
  weeksGenerated: number;
  totalPendingBeforeHours: number;
  projectPendingBeforeHours: number;
  lastWeekOutstandingHours?: number;
}) {
  const ctx = await requireDashboardContext();
  if (!ctx.naveId) {
    return {
      totalPendingHours: 0,
      projectPendingHours: 0,
      shouldContinue: false,
      stallReason: undefined as string | undefined,
    };
  }

  const parsed = generateSchema.parse({
    weekStart: input.weekStart,
    horizonMode: input.horizonMode,
  });
  const anchor = getMondayOf(new Date(parsed.weekStart));
  const projectId =
    parsed.horizonMode.kind === "PROJECT" ? parsed.horizonMode.projectId : undefined;

  const snapshot = await countPendingPlanningHours({
    naveId: ctx.naveId,
    beforeWeekStart: addWeeks(anchor, input.weeksGenerated),
    projectId,
  });

  const projectPending =
    projectId != null
      ? (snapshot.projectPendingHours.get(projectId) ?? 0)
      : 0;

  const progress = shouldContinueHorizon({
    mode: parsed.horizonMode,
    anchorWeekStart: anchor,
    weeksGenerated: input.weeksGenerated,
    totalPendingBeforeHours: input.totalPendingBeforeHours,
    totalPendingAfterHours: snapshot.totalPendingHours,
    projectPendingBeforeHours: input.projectPendingBeforeHours,
    projectPendingAfterHours: projectPending,
    lastWeekOutstandingHours: input.lastWeekOutstandingHours,
  });

  return {
    totalPendingHours: snapshot.totalPendingHours,
    projectPendingHours: projectPending,
    shouldContinue: progress.shouldContinue,
    stallReason: progress.stallReason,
    relevantPendingHours: relevantPendingHours(
      parsed.horizonMode,
      snapshot.totalPendingHours,
      projectPending,
    ),
  };
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

const undoSchema = z.object({
  weekStart: z.string().min(8),
  includeFutureWeeks: z.boolean().optional(),
});

export async function undoPlanningAction(input: {
  weekStart: string;
  includeFutureWeeks?: boolean;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");
  const { weekStart, includeFutureWeeks } = undoSchema.parse(input);
  const result = await undoPlanning({
    naveId: ctx.naveId,
    weekStart: new Date(weekStart),
    includeFutureWeeks,
  });
  revalidatePath("/dashboard", "layout");
  return result;
}

export async function getPlanningUndoState(weekStartIso: string): Promise<{
  canUndo: boolean;
  hasFuturePlannings: boolean;
  futurePlanningWeeks: string[];
  hasPublishedFuture: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
}> {
  const ctx = await requireDashboardContext();
  if (!ctx.naveId) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      futurePlanningWeeks: [],
      hasPublishedFuture: false,
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
      futurePlanningWeeks: [],
      hasPublishedFuture: false,
      hasRegistros: false,
      isPublished: false,
    };
  }

  const [futurePlannings, registros] = await Promise.all([
    listFuturePlannings(ctx.naveId, weekStart),
    hasRegistrosFromWeek(ctx.naveId, weekStart),
  ]);
  return {
    canUndo: !registros,
    hasFuturePlannings: futurePlannings.length > 0,
    futurePlanningWeeks: futurePlannings.map((p) => p.weekStart.toISOString()),
    hasPublishedFuture: futurePlannings.some((p) => p.status === "PUBLISHED"),
    hasRegistros: registros,
    isPublished: planning.status === "PUBLISHED",
  };
}
