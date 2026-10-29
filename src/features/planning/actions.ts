"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireDashboardContext, requireRole } from "@/lib/context";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction, runServerQuery } from "@/lib/server-action";
import { getMondayOf } from "@/lib/week";
import { loadActiveNaveIdsOrdered } from "@/features/naves/active-naves";
import {
  publishAllPlanningsForWeek,
  undoPlanningAllNaves,
} from "@/features/planning/service";
import {
  clearFutureDraftPlanningsAll,
  hasPublishedFuturePlanningsAll,
  isMultiWeekMode,
} from "@/features/planning/planning-horizon";
import { planningHorizonModeSchema } from "@/features/planning/planning-horizon-schema";
import { Role } from "@/generated/prisma";
import {
  startPlanningJob,
  executePlanningJob,
  getActivePlanningJob,
  getPlanningJobById,
  type PlanningJobProgress,
  type PlanningJobResult,
} from "./planning-job";

const publishSchema = z.object({ weekStart: z.string().min(8) });

export async function publishPlanningAction(input: {
  weekStart: string;
}): Promise<ActionResult<{ publishedCount: number }>> {
  return runServerAction(
    "planning.publishPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      if (ctx.naveId) {
        throw new Error(
          "El planning se publica para todas las naves. Quita el filtro de nave.",
        );
      }
      const { weekStart } = publishSchema.parse(input);
      const result = await publishAllPlanningsForWeek(new Date(weekStart));
      if (result.publishedCount === 0) {
        throw new Error("No hay plannings en borrador para publicar esta semana.");
      }
      revalidatePath("/dashboard", "layout");
      return { publishedCount: result.publishedCount };
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
}): Promise<ActionResult<{ deletedCount: number }>> {
  return runServerAction(
    "planning.undoPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      if (ctx.naveId) {
        throw new Error(
          "El planning se deshace para todas las naves. Quita el filtro de nave.",
        );
      }
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

// --------------- Async planning job actions ---------------

const startJobSchema = z.object({
  weekStart: z.string().min(8),
  horizonMode: planningHorizonModeSchema,
  planFromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function startPlanningJobAction(input: {
  weekStart: string;
  horizonMode: z.input<typeof planningHorizonModeSchema>;
  planFromDate?: string;
}): Promise<ActionResult<{ jobId: string }>> {
  return runServerAction(
    "planning.startPlanningJob",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      if (ctx.naveId) {
        throw new Error(
          "El planning se genera para todas las naves. Quita el filtro de nave.",
        );
      }
      const parsed = startJobSchema.parse(input);

      const naveIds = await loadActiveNaveIdsOrdered();
      const anchor = getMondayOf(new Date(parsed.weekStart));
      if (isMultiWeekMode(parsed.horizonMode)) {
        if (await hasPublishedFuturePlanningsAll(naveIds, anchor)) {
          throw new Error(
            "Hay plannings publicados en semanas posteriores. Deshaz o regenera esas semanas primero.",
          );
        }
        await clearFutureDraftPlanningsAll(naveIds, anchor);
      }

      const jobId = await startPlanningJob({
        weekStart: parsed.weekStart,
        horizonMode: parsed.horizonMode,
        planFromDate: parsed.planFromDate,
      });

      after(async () => {
        await executePlanningJob(jobId);
      });

      revalidatePath("/dashboard", "layout");
      return { jobId };
    },
    (result) => ({
      summary: `Iniciar job de planning asíncrono semana ${input.weekStart}`,
      entityType: "PlanningJob",
      entityId: result.jobId,
      metadata: {
        weekStart: input.weekStart,
        horizonMode: input.horizonMode,
        planFromDate: input.planFromDate,
      },
    }),
  );
}

export interface PlanningJobStatusResponse {
  jobId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: PlanningJobProgress | null;
  result: PlanningJobResult | null;
  error: string | null;
}

export async function getPlanningJobStatusAction(
  jobId: string,
): Promise<ActionResult<PlanningJobStatusResponse | null>> {
  return runServerQuery(
    "planning.getPlanningJobStatus",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      const job = await getPlanningJobById(jobId);
      if (!job) return null;
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress as PlanningJobProgress | null,
        result: job.result as PlanningJobResult | null,
        error: job.error,
      };
    },
  );
}

export async function getActivePlanningJobAction(): Promise<
  ActionResult<PlanningJobStatusResponse | null>
> {
  return runServerQuery("planning.getActivePlanningJob", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const job = await getActivePlanningJob();
    if (!job) return null;
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress as PlanningJobProgress | null,
      result: job.result as PlanningJobResult | null,
      error: job.error,
    };
  });
}
