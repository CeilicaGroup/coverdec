import type { Prisma } from "@/generated/prisma";
import { WorkOrderStatus } from "@/generated/prisma";

/** Cierra la OT si todas sus tareas están completadas. */
export async function closeWorkOrderIfAllTasksComplete(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<boolean> {
  const openCount = await tx.task.count({
    where: { workOrderId, isCompleted: false },
  });
  if (openCount > 0) return false;

  await tx.workOrder.update({
    where: { id: workOrderId },
    data: { status: WorkOrderStatus.CLOSED, closedAt: new Date() },
  });
  return true;
}

/** Reabre una OT cerrada (p. ej. al descompletar una tarea). */
export async function reopenWorkOrderIfClosed(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<boolean> {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { status: true },
  });
  if (!wo || wo.status !== WorkOrderStatus.CLOSED) return false;

  await tx.workOrder.update({
    where: { id: workOrderId },
    data: { status: WorkOrderStatus.OPEN, closedAt: null },
  });
  return true;
}
