import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { resolveTimeEntryHours } from "@/features/time-tracking/entry-hours";

type Tx = Prisma.TransactionClient | typeof prisma;

export interface TaskHourTotals {
  doneHours: number;
  remainingWorkHours: number;
}

export interface TaskPlanningTotals extends TaskHourTotals {
  pendingToPlanHours: number;
}

export async function loadDoneHoursByTaskIds(
  tx: Tx,
  taskIds: string[],
  at: Date = new Date(),
): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const entries = await tx.timeEntry.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, startedAt: true, endedAt: true, hours: true },
  });
  const doneByTaskId = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.taskId) continue;
    const done = resolveTimeEntryHours(entry, at);
    doneByTaskId.set(entry.taskId, (doneByTaskId.get(entry.taskId) ?? 0) + done);
  }
  return doneByTaskId;
}

export function computeTaskHourTotals(
  estimatedHours: number,
  doneHours: number,
): TaskHourTotals {
  const safeDone = Math.max(0, doneHours);
  return {
    doneHours: safeDone,
    remainingWorkHours: Math.max(0, estimatedHours - safeDone),
  };
}

export function computeTaskPlanningTotals(args: {
  estimatedHours: number;
  doneHours: number;
  priorPlannedHours?: number;
}): TaskPlanningTotals {
  const base = computeTaskHourTotals(args.estimatedHours, args.doneHours);
  const priorPlannedHours = Math.max(0, args.priorPlannedHours ?? 0);
  return {
    ...base,
    pendingToPlanHours: Math.max(0, base.remainingWorkHours - priorPlannedHours),
  };
}
