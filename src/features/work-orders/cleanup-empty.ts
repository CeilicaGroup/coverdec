import type { Prisma } from "@/generated/prisma";
import { WorkOrderStatus } from "@/generated/prisma";

/** Elimina OT abiertas sin ninguna tarea vinculada (p. ej. tras quitar todas las tareas). */
export async function deleteEmptyOpenWorkOrders(
  tx: Prisma.TransactionClient,
  workOrderIds: string[],
): Promise<number> {
  const uniqueIds = [...new Set(workOrderIds.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  let deleted = 0;
  for (const workOrderId of uniqueIds) {
    const workOrder = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, status: true },
    });
    if (!workOrder || workOrder.status !== WorkOrderStatus.OPEN) continue;

    const taskCount = await tx.task.count({ where: { workOrderId } });
    if (taskCount > 0) continue;

    await tx.workOrder.delete({ where: { id: workOrderId } });
    deleted += 1;
  }

  return deleted;
}
