import type { Prisma } from "@/generated/prisma";
import { deleteEmptyOpenWorkOrders } from "./cleanup-empty";
import { closeWorkOrderIfAllTasksComplete } from "./close";
import { sortTaskIdsForWorkOrderSequence } from "./order-ot-tasks";
import { isWorkOrderExemptTask } from "./task-ot-exemptions";

const taskSelectForValidation = {
  id: true,
  isCompleted: true,
  workOrderId: true,
  process: true,
  systemKind: true,
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

  if (tasks.some((task) => isWorkOrderExemptTask(task))) {
    throw new Error(
      "Las tareas imprevistas y de transporte no van en OT: quítalas de la selección.",
    );
  }

  for (const task of tasks) {
    // Una tarea completada que ya está en esta OT se conserva (editar notas/orden,
    // dividir); lo que no se puede es meter una tarea completada en otra OT abierta.
    if (task.isCompleted && task.workOrderId !== options.workOrderId) {
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

  const tasksForOrder = await tx.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      projectId: true,
      lampId: true,
      lampElementId: true,
      order: true,
    },
  });
  const orderedTaskIds = sortTaskIdsForWorkOrderSequence(tasksForOrder);

  const current = await tx.task.findMany({
    where: { workOrderId },
    select: { id: true },
  });
  const currentIds = new Set(current.map((t) => t.id));
  const nextIds = new Set(orderedTaskIds);

  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  if (toRemove.length > 0) {
    await tx.task.updateMany({
      where: { id: { in: toRemove } },
      data: { workOrderId: null, workOrderSequence: null },
    });
  }

  for (let i = 0; i < orderedTaskIds.length; i++) {
    await tx.task.update({
      where: { id: orderedTaskIds[i] },
      data: { workOrderId, workOrderSequence: i },
    });
  }

  const deleted = await deleteEmptyOpenWorkOrders(tx, [workOrderId]);
  // Si tras el cambio solo quedan tareas completadas, la OT queda cerrada (mismo
  // invariante que al completar la última tarea desde horas).
  if (deleted === 0) await closeWorkOrderIfAllTasksComplete(tx, workOrderId);
}
