import type { Prisma } from "@/generated/prisma";
import { WorkOrderStatus } from "@/generated/prisma";
import { workOrderGroupKey } from "@/features/work-orders/group-key";
import { assignTasksToWorkOrder } from "@/features/work-orders/validate-tasks";
import { excludeWorkOrderExemptTasksWhere } from "@/features/work-orders/task-ot-exemptions";

const groupKeySelect = {
  process: true,
  lampElement: { select: { elementType: { select: { id: true } } } },
  lamp: { select: { elementType: { select: { id: true } } } },
} as const;

/**
 * Engancha cada tarea pendiente de la lámpara a una OT abierta del proyecto destino
 * de su mismo grupo (tipo de elemento + proceso, como «Agrupar tareas idénticas»).
 * Una OT solo cuenta como de un grupo si todas sus tareas son de ese grupo.
 *
 * Si no hay OT de su grupo, la tarea queda sin OT: crear OT es decisión del admin
 * («Agrupar» u «Órdenes de trabajo»), igual que con una lámpara recién creada. No
 * bloquea el planning porque la lámpara llega del stock sin aprobar.
 *
 * Devuelve cuántas tareas se han enganchado.
 */
export async function tryAttachLampTasksToOpenWorkOrder(
  tx: Prisma.TransactionClient,
  args: { projectId: string; lampId: string },
): Promise<number> {
  const pendingTasks = await tx.task.findMany({
    where: {
      lampId: args.lampId,
      projectId: args.projectId,
      isCompleted: false,
      workOrderId: null,
      ...excludeWorkOrderExemptTasksWhere(),
    },
    select: { id: true, ...groupKeySelect },
    orderBy: { order: "asc" },
  });
  if (pendingTasks.length === 0) return 0;

  const openWorkOrders = await tx.workOrder.findMany({
    where: {
      status: WorkOrderStatus.OPEN,
      tasks: { some: { projectId: args.projectId } },
    },
    include: {
      tasks: {
        select: { id: true, ...groupKeySelect },
        orderBy: { workOrderSequence: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // La OT abierta más reciente de cada grupo homogéneo.
  const workOrderByGroup = new Map<string, (typeof openWorkOrders)[number]>();
  for (const workOrder of openWorkOrders) {
    const keys = new Set(workOrder.tasks.map((task) => workOrderGroupKey(task)));
    if (keys.size !== 1) continue;
    const [key] = [...keys];
    if (!key || workOrderByGroup.has(key)) continue;
    workOrderByGroup.set(key, workOrder);
  }

  const newTaskIdsByWorkOrder = new Map<string, string[]>();
  for (const task of pendingTasks) {
    const key = workOrderGroupKey(task);
    const workOrder = key ? workOrderByGroup.get(key) : undefined;
    if (!workOrder) continue;
    const list = newTaskIdsByWorkOrder.get(workOrder.id) ?? [];
    list.push(task.id);
    newTaskIdsByWorkOrder.set(workOrder.id, list);
  }

  let attached = 0;
  for (const [workOrderId, newTaskIds] of newTaskIdsByWorkOrder) {
    const workOrder = openWorkOrders.find((wo) => wo.id === workOrderId)!;
    await assignTasksToWorkOrder(tx, workOrderId, [
      ...workOrder.tasks.map((task) => task.id),
      ...newTaskIds,
    ]);
    attached += newTaskIds.length;
  }
  return attached;
}
