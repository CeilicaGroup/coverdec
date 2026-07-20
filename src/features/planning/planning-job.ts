import { prisma } from "@/lib/db";
import { PlanningJobStatus } from "@/generated/prisma";
import { childLogger } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import type { PlanningHorizonMode } from "./planning-horizon-schema";
import { planningHorizonModeSchema } from "./planning-horizon-schema";
import { generatePlanningAllNaves } from "./planning-all-naves";
import {
  addWeeks,
  countPendingPlanningHoursAll,
  isHorizonEmptyWeekError,
  maxWeeksForMode,
  PENDING_DONE_THRESHOLD_HOURS,
  relevantPendingHours,
  shouldContinueHorizon,
} from "./planning-horizon";
import { loadActiveNaveIdsOrdered } from "@/features/naves/active-naves";
import { assertPlanFromDateInWorkWeek } from "./plan-from";
import { getMondayOf } from "@/lib/week";

const log = childLogger({ module: "planning.job" });

const STALE_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export interface PlanningJobProgress {
  weeksGenerated: number;
  maxWeeks: number;
  currentWeekLabel: string;
  totalAssignments: number;
  totalUnscheduledHours: number;
  warningCount: number;
}

export interface PlanningJobResult {
  weeksGenerated: number;
  totalAssignments: number;
  totalUnscheduledHours: number;
  warnings: string[];
}

export async function getActivePlanningJob() {
  if (!hasPlanningJobDelegate()) return null;
  await cleanupStaleJobs();
  return prisma.planningJob.findFirst({
    where: {
      status: { in: [PlanningJobStatus.PENDING, PlanningJobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPlanningJobById(jobId: string) {
  if (!hasPlanningJobDelegate()) return null;
  return prisma.planningJob.findUnique({ where: { id: jobId } });
}

function hasPlanningJobDelegate(): boolean {
  return "planningJob" in prisma && prisma.planningJob != null;
}

export async function startPlanningJob(input: {
  weekStart: string;
  horizonMode: PlanningHorizonMode;
  planFromDate?: string;
}): Promise<string> {
  if (!hasPlanningJobDelegate()) {
    throw new Error(
      "El modelo PlanningJob no está disponible. Ejecuta prisma generate y reinicia la aplicación.",
    );
  }

  const existing = await getActivePlanningJob();
  if (existing) {
    throw new Error(
      "Ya hay un planning en proceso de generación. Espera a que termine.",
    );
  }

  if (input.planFromDate) {
    assertPlanFromDateInWorkWeek(input.weekStart, input.planFromDate);
  }

  const job = await prisma.planningJob.create({
    data: {
      status: PlanningJobStatus.PENDING,
      horizonMode: input.horizonMode as never,
      weekStart: new Date(input.weekStart),
      planFromDate: input.planFromDate,
    },
  });

  log.info({ jobId: job.id, weekStart: input.weekStart }, "planning job created");
  return job.id;
}

function weekIsoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function executePlanningJob(jobId: string): Promise<void> {
  const job = await prisma.planningJob.findUnique({ where: { id: jobId } });
  if (!job) {
    log.error({ jobId }, "planning job not found");
    return;
  }
  if (job.status !== PlanningJobStatus.PENDING) {
    log.warn({ jobId, status: job.status }, "planning job not in PENDING state, skipping");
    return;
  }

  await prisma.planningJob.update({
    where: { id: jobId },
    data: { status: PlanningJobStatus.RUNNING, startedAt: new Date() },
  });

  try {
    const horizonMode = planningHorizonModeSchema.parse(job.horizonMode);
    const weekStart = job.weekStart.toISOString().slice(0, 10);
    const maxWeeks = maxWeeksForMode(horizonMode);
    const naveIds = await loadActiveNaveIdsOrdered();

    let weekIndex = 0;
    let weeksGenerated = 0;
    let totalAssignments = 0;
    let totalUnscheduled = 0;
    const allWarnings: string[] = [];
    let totalPendingBefore = 0;
    let projectPendingBefore = 0;

    const projectId =
      horizonMode.kind === "PROJECT" ? horizonMode.projectId : undefined;

    const initialSnapshot = await countPendingPlanningHoursAll({
      naveIds,
      beforeWeekStart: addWeeks(new Date(weekStart), 0),
      projectId,
    });
    totalPendingBefore = initialSnapshot.totalPendingHours;
    projectPendingBefore = projectId
      ? (initialSnapshot.projectPendingHours.get(projectId) ?? 0)
      : 0;

    while (weekIndex < maxWeeks) {
      const currentWeekStart = addWeeks(new Date(weekStart), weekIndex);
      const weekIso = weekIsoFromDate(currentWeekStart);
      const weekNum = weekIndex + 1;

      const currentWeekLabel =
        maxWeeks > 1
          ? `Generando S${weekNum}${maxWeeks <= 4 ? `/${maxWeeks}` : ""}…`
          : "Generando planning…";

      await prisma.planningJob.update({
        where: { id: jobId },
        data: {
          progress: {
            weeksGenerated,
            maxWeeks,
            currentWeekLabel,
            totalAssignments,
            totalUnscheduledHours: totalUnscheduled,
            warningCount: allWarnings.length,
          } satisfies PlanningJobProgress,
        },
      });

      let result;
      try {
        result = await generatePlanningAllNaves({
          weekStart: new Date(weekIso),
          replaceDraft: true,
          planFrom: weekIndex === 0 && job.planFromDate ? "DATE" : "WEEK_START",
          planFromAt:
            weekIndex === 0 && job.planFromDate
              ? new Date(`${job.planFromDate}T00:00:00.000Z`)
              : currentWeekStart,
        });
      } catch (err) {
        if (weekIndex > 0 && isHorizonEmptyWeekError(err)) {
          const snapshot = await countPendingPlanningHoursAll({
            naveIds,
            beforeWeekStart: addWeeks(getMondayOf(new Date(weekStart)), weekIndex),
            projectId,
          });
          const projectPending = projectId
            ? (snapshot.projectPendingHours.get(projectId) ?? 0)
            : 0;
          const pendingAfter = relevantPendingHours(
            horizonMode,
            snapshot.totalPendingHours,
            projectPending,
          );

          log.info(
            {
              jobId,
              weekIso,
              weekIndex,
              pendingAfter,
            },
            "skipping week with no schedulable work",
          );

          weekIndex += 1;
          if (pendingAfter <= PENDING_DONE_THRESHOLD_HOURS) {
            break;
          }
          continue;
        }
        throw err;
      }

      weeksGenerated += 1;
      weekIndex += 1;
      totalAssignments += result.assignmentsCount;
      totalUnscheduled += result.unscheduledHours;
      allWarnings.push(...result.warnings);

      const snapshot = await countPendingPlanningHoursAll({
        naveIds,
        beforeWeekStart: addWeeks(getMondayOf(new Date(weekStart)), weeksGenerated),
        projectId,
      });

      const projectPending = projectId
        ? (snapshot.projectPendingHours.get(projectId) ?? 0)
        : 0;

      const progress = shouldContinueHorizon({
        mode: horizonMode,
        anchorWeekStart: getMondayOf(new Date(weekStart)),
        weeksGenerated,
        totalPendingBeforeHours: totalPendingBefore,
        totalPendingAfterHours: snapshot.totalPendingHours,
        projectPendingBeforeHours: projectPendingBefore,
        projectPendingAfterHours: projectPending,
        lastWeekOutstandingHours: result.unscheduledHours,
      });

      totalPendingBefore = snapshot.totalPendingHours;
      projectPendingBefore = projectPending;

      if (!progress.shouldContinue) break;
    }

    const jobResult: PlanningJobResult = {
      weeksGenerated,
      totalAssignments,
      totalUnscheduledHours: totalUnscheduled,
      warnings: allWarnings,
    };

    await prisma.planningJob.update({
      where: { id: jobId },
      data: {
        status: PlanningJobStatus.COMPLETED,
        completedAt: new Date(),
        result: jobResult as never,
        progress: {
          weeksGenerated,
          maxWeeks,
          currentWeekLabel: "Completado",
          totalAssignments,
          totalUnscheduledHours: totalUnscheduled,
          warningCount: allWarnings.length,
        } satisfies PlanningJobProgress,
      },
    });

    revalidatePath("/dashboard", "layout");
    log.info(
      { jobId, weeksGenerated, totalAssignments },
      "planning job completed",
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Error desconocido";

    await prisma.planningJob.update({
      where: { id: jobId },
      data: {
        status: PlanningJobStatus.FAILED,
        completedAt: new Date(),
        error: errorMessage,
      },
    });

    revalidatePath("/dashboard", "layout");
    log.error({ jobId, err }, "planning job failed");
  }
}

export async function cleanupStaleJobs(): Promise<number> {
  if (!hasPlanningJobDelegate()) {
    log.warn("planningJob delegate missing — run prisma generate and restart");
    return 0;
  }

  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
  const result = await prisma.planningJob.updateMany({
    where: {
      status: { in: [PlanningJobStatus.PENDING, PlanningJobStatus.RUNNING] },
      createdAt: { lt: cutoff },
    },
    data: {
      status: PlanningJobStatus.FAILED,
      completedAt: new Date(),
      error: "Job expirado por timeout",
    },
  });

  if (result.count > 0) {
    log.warn({ count: result.count }, "stale planning jobs cleaned up");
  }
  return result.count;
}
