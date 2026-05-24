import type { Prisma } from "@/generated/prisma";
import type { ProcessCode } from "@/types/process";
import { prisma } from "@/lib/db";

export interface TaskBlueprint {
  process: ProcessCode;
  estimatedHours: number;
  order: number;
}

export async function buildTasksFromFrame(
  frameTypeId: string,
  surfaceM2: number,
): Promise<TaskBlueprint[]> {
  const frameProcesses = await prisma.frameTypeProcess.findMany({
    where: { frameTypeId },
    orderBy: { sequence: "asc" },
  });
  const blueprints: TaskBlueprint[] = [];
  let order = 0;
  for (const fp of frameProcesses) {
    const hours = fp.hoursPerUnit * surfaceM2 + fp.fixedHours;
    if (hours <= 0) continue;
    blueprints.push({
      process: fp.process,
      estimatedHours: hours,
      order: order++,
    });
  }
  return blueprints;
}

export function adjustPendingOnEstimateChange(
  estimatedHours: number,
  doneHours: number,
  currentPending: number,
): number {
  const minPending = Math.max(0, estimatedHours - doneHours);
  return Math.max(minPending, Math.min(currentPending, estimatedHours));
}

export async function getNextTaskOrder(
  tx: Prisma.TransactionClient,
  lampId: string,
): Promise<number> {
  const agg = await tx.task.aggregate({
    where: { lampId },
    _max: { order: true },
  });
  return (agg._max.order ?? -1) + 1;
}

export function filterUnlockedTasks<
  T extends { id: string; lampId: string; order: number; pendingHours: number },
>(tasks: T[]): T[] {
  const byLamp = new Map<string, T[]>();
  for (const t of tasks) {
    const list = byLamp.get(t.lampId) ?? [];
    list.push(t);
    byLamp.set(t.lampId, list);
  }
  for (const list of byLamp.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  return tasks.filter((task) => {
    const lampTasks = byLamp.get(task.lampId) ?? [];
    for (const prev of lampTasks) {
      if (prev.order >= task.order) break;
      if (prev.pendingHours > 0) return false;
    }
    return true;
  });
}

export async function isTaskUnlocked(
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: { lampId: true, order: true },
  });
  if (!task) return false;

  const blockers = await tx.task.count({
    where: {
      lampId: task.lampId,
      order: { lt: task.order },
      pendingHours: { gt: 0 },
    },
  });
  return blockers === 0;
}
