import { PlanningStatus } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import {
  computeTaskPlanningTotals,
  loadDoneHoursByTaskIds,
} from "@/features/time-tracking/task-hours-derived";
import type { PlanningHorizonMode } from "@/features/planning/planning-horizon-schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tope de seguridad para evitar bucles infinitos (~6 meses). */
export const MAX_HORIZON_WEEKS = 26;

export const MONTH_HORIZON_WEEKS = 4;

/** Alineado con UNSCHEDULED_FAIL_THRESHOLD_HOURS en service.ts. */
export const PENDING_DONE_THRESHOLD_HOURS = 0.25;

export interface HorizonProgressInput {
  mode: PlanningHorizonMode;
  anchorWeekStart: Date;
  weeksGenerated: number;
  /** Pendiente global antes de generar la semana actual. */
  totalPendingBeforeHours: number;
  /** Pendiente global tras la última semana generada. */
  totalPendingAfterHours: number;
  /** Pendiente del proyecto objetivo (modo PROJECT). */
  projectPendingBeforeHours: number;
  projectPendingAfterHours: number;
  /** Horas sin colocar en la última semana (aplazadas o sin capacidad). */
  lastWeekOutstandingHours?: number;
}

export interface HorizonProgressResult {
  shouldContinue: boolean;
  stallReason?: "no_progress" | "max_weeks" | "pending_done" | "date_reached";
}

export function addWeeks(weekStart: Date, count: number): Date {
  return new Date(getMondayOf(weekStart).getTime() + count * 7 * DAY_MS);
}

export function weekContainsDate(weekStart: Date, isoDate: string): boolean {
  const monday = getMondayOf(weekStart);
  const friday = new Date(monday.getTime() + 4 * DAY_MS);
  const target = new Date(`${isoDate}T00:00:00.000Z`);
  return target.getTime() >= monday.getTime() && target.getTime() <= friday.getTime();
}

export function isWeekStartPastDate(weekStart: Date, untilIso: string): boolean {
  const monday = getMondayOf(weekStart);
  const untilMonday = getMondayOf(new Date(`${untilIso}T00:00:00.000Z`));
  return monday.getTime() > untilMonday.getTime();
}

export function maxWeeksForMode(mode: PlanningHorizonMode): number {
  switch (mode.kind) {
    case "WEEK":
      return 1;
    case "MONTH":
      return MONTH_HORIZON_WEEKS;
    case "ALL_PROJECTS":
    case "PROJECT":
    case "UNTIL_DATE":
      return MAX_HORIZON_WEEKS;
  }
}

export function isMultiWeekMode(mode: PlanningHorizonMode): boolean {
  return mode.kind !== "WEEK";
}

export function relevantPendingHours(
  mode: PlanningHorizonMode,
  totalPendingHours: number,
  projectPendingHours: number,
): number {
  return mode.kind === "PROJECT" ? projectPendingHours : totalPendingHours;
}

export function shouldContinueHorizon(input: HorizonProgressInput): HorizonProgressResult {
  const {
    mode,
    anchorWeekStart,
    weeksGenerated,
    totalPendingBeforeHours,
    totalPendingAfterHours,
    projectPendingBeforeHours,
    projectPendingAfterHours,
    lastWeekOutstandingHours = 0,
  } = input;
  const maxWeeks = maxWeeksForMode(mode);
  const pendingAfter = relevantPendingHours(
    mode,
    totalPendingAfterHours,
    projectPendingAfterHours,
  );
  const pendingBefore = relevantPendingHours(
    mode,
    totalPendingBeforeHours,
    projectPendingBeforeHours,
  );

  if (weeksGenerated >= maxWeeks) {
    return { shouldContinue: false, stallReason: "max_weeks" };
  }

  if (mode.kind === "WEEK") {
    return { shouldContinue: false };
  }

  if (pendingAfter <= PENDING_DONE_THRESHOLD_HOURS) {
    return { shouldContinue: false, stallReason: "pending_done" };
  }

  if (mode.kind === "UNTIL_DATE") {
    const nextWeekStart = addWeeks(anchorWeekStart, weeksGenerated);
    if (isWeekStartPastDate(nextWeekStart, mode.untilIso)) {
      return { shouldContinue: false, stallReason: "date_reached" };
    }
  }

  if (
    weeksGenerated > 0 &&
    Math.abs(pendingAfter - pendingBefore) < 1e-6 &&
    pendingAfter > PENDING_DONE_THRESHOLD_HOURS &&
    lastWeekOutstandingHours <= PENDING_DONE_THRESHOLD_HOURS
  ) {
    return { shouldContinue: false, stallReason: "no_progress" };
  }

  return { shouldContinue: true };
}

export async function hasPublishedFuturePlannings(
  naveId: string,
  fromWeekStart: Date,
): Promise<boolean> {
  const monday = getMondayOf(fromWeekStart);
  const count = await prisma.planning.count({
    where: {
      naveId,
      weekStart: { gt: monday },
      status: PlanningStatus.PUBLISHED,
    },
  });
  return count > 0;
}

export async function clearFutureDraftPlannings(
  naveId: string,
  fromWeekStart: Date,
): Promise<number> {
  const monday = getMondayOf(fromWeekStart);
  const result = await prisma.planning.deleteMany({
    where: {
      naveId,
      weekStart: { gt: monday },
      status: PlanningStatus.DRAFT,
    },
  });
  return result.count;
}

export interface PendingPlanningSnapshot {
  totalPendingHours: number;
  projectPendingHours: Map<string, number>;
}

export async function countPendingPlanningHours(args: {
  naveId: string;
  beforeWeekStart: Date;
  projectId?: string;
}): Promise<PendingPlanningSnapshot> {
  const beforeMonday = getMondayOf(args.beforeWeekStart);

  const [priorRows] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        planning: {
          naveId: args.naveId,
          weekStart: { lt: beforeMonday },
        },
      },
      select: { taskId: true, hours: true },
    }),
  ]);

  const allTasks = await prisma.task.findMany({
    where: {
      naveId: args.naveId,
      project: { isActive: true },
      ...(args.projectId ? { projectId: args.projectId } : {}),
    },
    select: {
      id: true,
      projectId: true,
      estimatedHours: true,
      isCompleted: true,
    },
  });

  const priorByTask = new Map<string, number>();
  for (const row of priorRows) {
    priorByTask.set(row.taskId, (priorByTask.get(row.taskId) ?? 0) + row.hours);
  }

  const doneHoursByTask = await loadDoneHoursByTaskIds(
    prisma,
    allTasks.map((t) => t.id),
  );

  let totalPendingHours = 0;
  const projectPendingHours = new Map<string, number>();

  for (const task of allTasks) {
    const totals = computeTaskPlanningTotals({
      estimatedHours: task.estimatedHours,
      doneHours: doneHoursByTask.get(task.id) ?? 0,
      priorPlannedHours: priorByTask.get(task.id) ?? 0,
    });
    if (task.isCompleted || totals.pendingToPlanHours <= PENDING_DONE_THRESHOLD_HOURS) {
      continue;
    }
    totalPendingHours += totals.pendingToPlanHours;
    projectPendingHours.set(
      task.projectId,
      (projectPendingHours.get(task.projectId) ?? 0) + totals.pendingToPlanHours,
    );
  }

  return { totalPendingHours, projectPendingHours };
}
