import type { Prisma } from "@/generated/prisma";
import { WorkOrderStatus } from "@/generated/prisma";
import { assignTasksToWorkOrder } from "@/features/work-orders/validate-tasks";
import { excludeWorkOrderExemptTasksWhere } from "@/features/work-orders/task-ot-exemptions";

/** Intenta agrupar tareas pendientes de la lámpara en una OT abierta del proyecto destino. */
export async function tryAttachLampTasksToOpenWorkOrder(
  tx: Prisma.TransactionClient,
  args: { projectId: string; lampId: string },
): Promise<boolean> {
  const pendingTasks = await tx.task.findMany({
    where: {
      lampId: args.lampId,
      projectId: args.projectId,
      isCompleted: false,
      workOrderId: null,
      ...excludeWorkOrderExemptTasksWhere(),
    },
    select: { id: true },
    orderBy: { order: "asc" },
  });
  if (pendingTasks.length === 0) return false;

  const openWorkOrder = await tx.workOrder.findFirst({
    where: {
      status: WorkOrderStatus.OPEN,
      tasks: { some: { projectId: args.projectId } },
    },
    include: {
      tasks: {
        select: { id: true },
        orderBy: { workOrderSequence: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!openWorkOrder) return false;

  const taskIds = [
    ...openWorkOrder.tasks.map((task) => task.id),
    ...pendingTasks.map((task) => task.id),
  ];
  await assignTasksToWorkOrder(tx, openWorkOrder.id, taskIds);
  return true;
}
