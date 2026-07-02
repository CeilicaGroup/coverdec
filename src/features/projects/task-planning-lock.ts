import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export const TASK_PLANNED_ERROR =
  "La tarea tiene asignaciones de planning; no se puede modificar.";

export function taskHasPlanningAssignments(task: {
  _count?: { assignments: number };
}): boolean {
  return (task._count?.assignments ?? 0) > 0;
}

export function assertTasksNotPlannedFromRows(
  tasks: Array<{ _count?: { assignments: number } }>,
): void {
  if (tasks.some((task) => taskHasPlanningAssignments(task))) {
    throw new Error(TASK_PLANNED_ERROR);
  }
}

export async function assertTasksNotPlanned(
  taskIds: string[],
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (taskIds.length === 0) return;

  const uniqueIds = [...new Set(taskIds)];
  const tasks = await tx.task.findMany({
    where: { id: { in: uniqueIds } },
    select: { _count: { select: { assignments: true } } },
  });

  assertTasksNotPlannedFromRows(tasks);
}

export async function lampChainHasPlanningAssignments(
  tx: Prisma.TransactionClient | typeof prisma,
  lampId: string,
  lampElementId: string | null,
): Promise<boolean> {
  const count = await tx.task.count({
    where: {
      lampId,
      lampElementId,
      assignments: { some: {} },
    },
  });
  return count > 0;
}
