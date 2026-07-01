"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { getMondayOf, isoWeek } from "@/lib/week";
import { loadActiveNaveIdsOrdered } from "@/features/naves/active-naves";
import {
  publishAllPlanningsForWeek,
  undoPlanningAllNaves,
  listFuturePlannings,
} from "@/features/planning/service";
import { generatePlanningAllNaves } from "@/features/planning/planning-all-naves";
import {
  addWeeks,
  clearFutureDraftPlanningsAll,
  countPendingPlanningHoursAll,
  hasPublishedFuturePlanningsAll,
  isMultiWeekMode,
  relevantPendingHours,
  shouldContinueHorizon,
} from "@/features/planning/planning-horizon";
import { planningHorizonModeSchema } from "@/features/planning/planning-horizon-schema";
import { assertPlanFromDateInWorkWeek } from "@/features/planning/plan-from";
import { hasRegistrosFromWeekAll } from "@/features/planning/planning-registros";
import { prisma } from "@/lib/db";
import { Role, PlanningStatus } from "@/generated/prisma";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const generateSchema = z.object({
  weekStart: z.string().min(8),
  horizonMode: planningHorizonModeSchema,
  planFromDate: isoDateSchema.optional(),
});

export async function generatePlanningAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
  planFromDate?: string;
}) {
  return runAuditedMutation(
    "planning.generatePlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      if (ctx.naveId) {
        throw new Error(
          "El planning se genera para todas las naves. Quita el filtro de nave.",
        );
      }
      const { weekStart, horizonMode, planFromDate } = generateSchema.parse(input);

      const planFrom =
        planFromDate !== undefined
          ? ("DATE" as const)
          : ("WEEK_START" as const);

      if (planFrom === "DATE") {
        assertPlanFromDateInWorkWeek(weekStart, planFromDate!);
      }

      const result = await generatePlanningAllNaves({
        weekStart: new Date(weekStart),
        replaceDraft: true,
        planFrom,
        planFromAt:
          planFrom === "DATE"
            ? new Date(`${planFromDate}T00:00:00.000Z`)
            : new Date(),
      });
      revalidatePath("/dashboard", "layout");
      return {
        planningId: result.planningIds[0] ?? "",
        warnings: result.warnings,
        unscheduledHours: result.unscheduledHours,
        assignmentsCount: result.assignmentsCount,
      };
    },
    (result) => ({
      summary: `Generar planning global semana ${input.weekStart}`,
      entityType: "Planning",
      entityId: result.planningId,
      metadata: {
        weekStart: input.weekStart,
        horizonMode: input.horizonMode,
        planFromDate: input.planFromDate,
        global: true,
      },
    }),
  );
}

export async function prepareHorizonGenerationAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
}) {
  return runAuditedMutation(
    "planning.prepareHorizonGeneration",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      if (ctx.naveId) {
        throw new Error(
          "El planning se genera para todas las naves. Quita el filtro de nave.",
        );
      }

      const naveIds = await loadActiveNaveIdsOrdered();
      const { weekStart, horizonMode } = generateSchema.parse(input);
      const anchor = getMondayOf(new Date(weekStart));

      if (isMultiWeekMode(horizonMode)) {
        if (await hasPublishedFuturePlanningsAll(naveIds, anchor)) {
          throw new Error(
            "Hay plannings publicados en semanas posteriores. Deshaz o regenera esas semanas primero.",
          );
        }
        await clearFutureDraftPlanningsAll(naveIds, anchor);
      }

      revalidatePath("/dashboard", "layout");
      return { ok: true as const };
    },
    {
      summary: `Preparar horizonte de planning global desde ${input.weekStart}`,
      metadata: input,
    },
  );
}

export async function getPlanningHorizonProgressAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
  weeksGenerated: number;
  totalPendingBeforeHours: number;
  projectPendingBeforeHours: number;
  lastWeekOutstandingHours?: number;
}) {
  await requireDashboardContext();
  const naveIds = await loadActiveNaveIdsOrdered();

  const parsed = generateSchema.parse({
    weekStart: input.weekStart,
    horizonMode: input.horizonMode,
  });
  const anchor = getMondayOf(new Date(parsed.weekStart));
  const projectId =
    parsed.horizonMode.kind === "PROJECT" ? parsed.horizonMode.projectId : undefined;

  const snapshot = await countPendingPlanningHoursAll({
    naveIds,
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

const publishSchema = z.object({ weekStart: z.string().min(8) });

export async function publishPlanningAction(input: { weekStart: string }) {
  return runAuditedMutation(
    "planning.publishPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const { weekStart } = publishSchema.parse(input);
      const result = await publishAllPlanningsForWeek(new Date(weekStart));
      if (result.publishedCount === 0) {
        throw new Error("No hay plannings en borrador para publicar esta semana.");
      }
      revalidatePath("/dashboard", "layout");
      return { ok: true as const, publishedCount: result.publishedCount };
    },
    (result) => ({
      summary: `Publicar planning global semana ${input.weekStart}`,
      entityType: "Planning",
      metadata: {
        weekStart: input.weekStart,
        publishedCount: result.publishedCount,
      },
    }),
  );
}

const undoSchema = z.object({
  weekStart: z.string().min(8),
  includeFutureWeeks: z.boolean().optional(),
});

export async function undoPlanningAction(input: {
  weekStart: string;
  includeFutureWeeks?: boolean;
}) {
  return runAuditedMutation(
    "planning.undoPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const { weekStart, includeFutureWeeks } = undoSchema.parse(input);
      const result = await undoPlanningAllNaves({
        weekStart: new Date(weekStart),
        includeFutureWeeks,
      });
      revalidatePath("/dashboard", "layout");
      return result;
    },
    {
      summary: `Deshacer planning global semana ${input.weekStart}`,
      metadata: input,
    },
  );
}

export async function getPlanningUndoState(weekStartIso: string): Promise<{
  canUndo: boolean;
  hasFuturePlannings: boolean;
  futurePlanningWeeks: string[];
  hasPublishedFuture: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
  hasPlanning: boolean;
  anyDraft: boolean;
}> {
  await requireDashboardContext();
  const weekStart = getMondayOf(new Date(weekStartIso));
  const naveIds = await loadActiveNaveIdsOrdered();
  const { year, week } = isoWeek(weekStart);

  const plannings = await prisma.planning.findMany({
    where: { year, week, naveId: { in: naveIds } },
    select: { id: true, status: true },
  });

  const hasPlanning = plannings.length > 0;
  if (!hasPlanning) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      futurePlanningWeeks: [],
      hasPublishedFuture: false,
      hasRegistros: false,
      isPublished: false,
      hasPlanning: false,
      anyDraft: false,
    };
  }

  const futureByNave = await Promise.all(
    naveIds.map((naveId) => listFuturePlannings(naveId, weekStart)),
  );
  const futurePlannings = futureByNave.flat();
  const futureWeekSet = new Set(
    futurePlannings.map((p) => p.weekStart.toISOString()),
  );
  const futurePlanningWeeks = [...futureWeekSet].sort();

  const hasRegistros = await hasRegistrosFromWeekAll(naveIds, weekStart);

  return {
    canUndo: !hasRegistros,
    hasFuturePlannings: futurePlannings.length > 0,
    futurePlanningWeeks,
    hasPublishedFuture: futurePlannings.some(
      (p) => p.status === PlanningStatus.PUBLISHED,
    ),
    hasRegistros,
    isPublished: plannings.every((p) => p.status === PlanningStatus.PUBLISHED),
    hasPlanning: true,
    anyDraft: plannings.some((p) => p.status === PlanningStatus.DRAFT),
  };
}
