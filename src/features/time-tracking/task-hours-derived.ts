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

/** Operario con más horas registradas por tarea (para fijar continuidad). */
export async function loadPrimaryWorkerByTaskIds(
  tx: Tx,
  taskIds: string[],
  at: Date = new Date(),
): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map();
  const entries = await tx.timeEntry.findMany({
    where: {
      taskId: { in: taskIds },
      user: { personId: { not: null } },
    },
    select: {
      taskId: true,
      startedAt: true,
      endedAt: true,
      hours: true,
      user: { select: { personId: true } },
    },
  });
  const hoursByTaskPerson = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const personId = entry.user.personId;
    if (!entry.taskId || !personId) continue;
    const hours = resolveTimeEntryHours(entry, at);
    if (hours <= 0) continue;
    let byPerson = hoursByTaskPerson.get(entry.taskId);
    if (!byPerson) {
      byPerson = new Map();
      hoursByTaskPerson.set(entry.taskId, byPerson);
    }
    byPerson.set(personId, (byPerson.get(personId) ?? 0) + hours);
  }
  const ownerByTask = new Map<string, string>();
  for (const [taskId, byPerson] of hoursByTaskPerson) {
    let bestPerson: string | null = null;
    let bestHours = -1;
    for (const [personId, hours] of byPerson) {
      if (hours > bestHours) {
        bestHours = hours;
        bestPerson = personId;
      }
    }
    if (bestPerson) ownerByTask.set(taskId, bestPerson);
  }
  return ownerByTask;
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

/** Tareas completadas cuentan como 100% de su estimado aunque no tengan fichajes. */
export function resolveTaskDoneHours(task: {
  estimatedHours: number;
  doneHours: number;
  isCompleted: boolean;
}): number {
  if (task.isCompleted) return task.estimatedHours;
  return task.doneHours;
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
