"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { getMondayOf, isoWeek } from "@/lib/week";
import {
  generatePlanning,
  hasRegistrosFromWeek,
  listFuturePlannings,
  publishPlanningForWeek,
  undoPlanning,
} from "@/features/planning/service";
import { getCoordinatedPlanningNaveIds } from "@/features/planning/coordinated-naves";
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
import {
  assertPlanFromDateInWorkWeek,
} from "@/features/planning/plan-from";
import { Role } from "@/generated/prisma";

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
      const { weekStart, horizonMode, planFromDate } =
        generateSchema.parse(input);

      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      if (naveIds.length === 0) {
        throw new Error("No hay naves activas para planificar");
      }

      const planFrom =
        planFromDate !== undefined
          ? ("DATE" as const)
          : ("WEEK_START" as const);

      if (planFrom === "DATE") {
        assertPlanFromDateInWorkWeek(weekStart, planFromDate!);
      }

      const planFromAt =
        planFrom === "DATE"
          ? new Date(`${planFromDate}T00:00:00.000Z`)
          : new Date();

      const result = await generatePlanning({
        naveIds,
        weekStart: new Date(weekStart),
        replaceDraft: true,
        planFrom,
        planFromAt,
      });
      revalidatePath("/dashboard", "layout");
      return {
        planningId: result.plannings[0]?.planningId ?? "",
        planningGroupId: result.planningGroupId,
        warnings: result.warnings,
        unscheduledHours: result.unscheduledHours,
        assignmentsCount: result.assignmentsCount,
        coordinatedNaves: result.plannings.length,
      };
    },
    (result) => ({
      summary: `Generar planning semana ${input.weekStart}`,
      entityType: "Planning",
      entityId: result.planningId,
      metadata: {
        weekStart: input.weekStart,
        horizonMode: input.horizonMode,
        planFromDate: input.planFromDate,
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
      const { weekStart, horizonMode } = generateSchema.parse(input);
      const targetNaveIds = await getCoordinatedPlanningNaveIds(ctx);
      if (targetNaveIds.length === 0) {
        throw new Error("No hay naves activas para planificar");
      }

      const anchor = getMondayOf(new Date(weekStart));

      if (isMultiWeekMode(horizonMode)) {
        for (const naveId of targetNaveIds) {
          if (await hasPublishedFuturePlannings(naveId, anchor)) {
            throw new Error(
              "Hay plannings publicados en semanas posteriores. Deshaz o regenera esas semanas primero.",
            );
          }
        }
        for (const naveId of targetNaveIds) {
          await clearFutureDraftPlannings(naveId, anchor);
        }
      }

      revalidatePath("/dashboard", "layout");
      return { ok: true as const };
    },
    {
      summary: `Preparar horizonte de planning desde ${input.weekStart}`,
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
  const ctx = await requireDashboardContext();
  const coordinatedNaveIds = await getCoordinatedPlanningNaveIds(ctx);
  const progressNaveId = coordinatedNaveIds[0] ?? null;
  if (!progressNaveId) {
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
    naveId: progressNaveId,
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
  return runAuditedMutation(
    "planning.publishPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const { planningId } = publishSchema.parse(input);
      const planning = await prisma.planning.findUnique({
        where: { id: planningId },
        select: { naveId: true, year: true, week: true, status: true },
      });
      if (!planning) throw new Error("Planning no encontrado");

      const coordinatedNaveIds = await getCoordinatedPlanningNaveIds(ctx);
      if (!coordinatedNaveIds.includes(planning.naveId)) {
        throw new Error("No autorizado");
      }

      const result = await publishPlanningForWeek({
        naveIds: coordinatedNaveIds,
        year: planning.year,
        week: planning.week,
      });
      if (result.publishedCount === 0) {
        throw new Error("No hay borradores pendientes de publicar");
      }
      revalidatePath("/dashboard", "layout");
      return { ok: true as const, publishedCount: result.publishedCount };
    },
    {
      summary: "Publicar planning",
      entityType: "Planning",
      entityId: input.planningId,
    },
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
      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      if (naveIds.length === 0) {
        throw new Error("No hay naves activas para planificar");
      }

      const result = await undoPlanning({
        naveIds,
        weekStart: new Date(weekStart),
        includeFutureWeeks,
      });
      revalidatePath("/dashboard", "layout");
      return result;
    },
    {
      summary: `Deshacer planning semana ${input.weekStart}`,
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
  hasDraft: boolean;
  planningIds: string[];
  coordinatedNaveCount: number;
}> {
  const ctx = await requireDashboardContext();
  const coordinatedNaveIds = await getCoordinatedPlanningNaveIds(ctx);
  if (coordinatedNaveIds.length === 0) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      futurePlanningWeeks: [],
      hasPublishedFuture: false,
      hasRegistros: false,
      isPublished: false,
      hasDraft: false,
      planningIds: [],
      coordinatedNaveCount: 0,
    };
  }

  const weekStart = getMondayOf(new Date(weekStartIso));
  const { year, week } = isoWeek(weekStart);

  const plannings = await prisma.planning.findMany({
    where: {
      naveId: { in: coordinatedNaveIds },
      year,
      week,
    },
    select: { id: true, status: true },
  });

  if (plannings.length === 0) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      futurePlanningWeeks: [],
      hasPublishedFuture: false,
      hasRegistros: false,
      isPublished: false,
      hasDraft: false,
      planningIds: [],
      coordinatedNaveCount: coordinatedNaveIds.length,
    };
  }

  const [futurePlanningsByNave, registrosByNave] = await Promise.all([
    Promise.all(
      coordinatedNaveIds.map((naveId) => listFuturePlannings(naveId, weekStart)),
    ),
    Promise.all(
      coordinatedNaveIds.map((naveId) => hasRegistrosFromWeek(naveId, weekStart)),
    ),
  ]);

  const futurePlannings = futurePlanningsByNave.flat();
  const hasRegistros = registrosByNave.some(Boolean);
  const hasDraft = plannings.some((p) => p.status === "DRAFT");
  const isPublished = plannings.every((p) => p.status === "PUBLISHED");

  return {
    canUndo: !hasRegistros,
    hasFuturePlannings: futurePlannings.length > 0,
    futurePlanningWeeks: [
      ...new Set(futurePlannings.map((p) => p.weekStart.toISOString())),
    ].sort(),
    hasPublishedFuture: futurePlannings.some((p) => p.status === "PUBLISHED"),
    hasRegistros,
    isPublished,
    hasDraft,
    planningIds: plannings.map((p) => p.id),
    coordinatedNaveCount: coordinatedNaveIds.length,
  };
}
