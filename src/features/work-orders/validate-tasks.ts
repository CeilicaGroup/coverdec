import type { Prisma } from "@/generated/prisma";

const taskSelectForValidation = {
  id: true,
  isCompleted: true,
  workOrderId: true,
} as const;

export async function assertTasksEligibleForWorkOrder(
  tx: Prisma.TransactionClient,
  taskIds: string[],
  options: { workOrderId?: string } = {},
) {
  const uniqueIds = [...new Set(taskIds)];
  if (uniqueIds.length !== taskIds.length) {
    throw new Error("Hay tareas duplicadas en la selección.");
  }

  const tasks = await tx.task.findMany({
    where: { id: { in: uniqueIds } },
    select: taskSelectForValidation,
  });

  if (tasks.length !== uniqueIds.length) {
    throw new Error("Alguna tarea seleccionada no existe.");
  }

  for (const task of tasks) {
    if (task.isCompleted) {
      throw new Error("No se pueden incluir tareas ya completadas en una OT abierta.");
    }
    if (task.workOrderId && task.workOrderId !== options.workOrderId) {
      throw new Error("Alguna tarea ya pertenece a otra OT.");
    }
  }
}

export async function assignTasksToWorkOrder(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  taskIds: string[],
) {
  await assertTasksEligibleForWorkOrder(tx, taskIds, { workOrderId });

  const current = await tx.task.findMany({
    where: { workOrderId },
    select: { id: true },
  });
  const currentIds = new Set(current.map((t) => t.id));
  const nextIds = new Set(taskIds);

  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  if (toRemove.length > 0) {
    await tx.task.updateMany({
      where: { id: { in: toRemove } },
      data: { workOrderId: null, workOrderSequence: null },
    });
  }

  for (let i = 0; i < taskIds.length; i++) {
    await tx.task.update({
      where: { id: taskIds[i] },
      data: { workOrderId, workOrderSequence: i },
    });
  }
}
