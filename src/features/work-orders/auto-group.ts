import type { Prisma } from "@/generated/prisma";
import { allocateWorkOrderNumber } from "./number";
import { groupTasksForAutoWorkOrders } from "./queries";
import { assignTasksToWorkOrder } from "./validate-tasks";

export interface AutoGroupResult {
  ordersCreated: number;
  tasksGrouped: number;
}

export async function autoGroupIdenticalTasksInTx(
  tx: Prisma.TransactionClient,
): Promise<AutoGroupResult> {
  const tasks = await tx.task.findMany({
    where: {
      isCompleted: false,
      workOrderId: null,
      project: { isActive: true },
    },
    select: {
      id: true,
      process: true,
      lampElement: {
        select: { elementType: { select: { id: true } } },
      },
      lamp: {
        select: { elementType: { select: { id: true } } },
      },
    },
  });
  const groups = groupTasksForAutoWorkOrders(tasks);

  let ordersCreated = 0;
  let tasksGrouped = 0;

  for (const groupTasks of groups.values()) {
    const taskIds = groupTasks.map((t) => t.id);
    const { year, serial, number } = await allocateWorkOrderNumber(tx);
    const workOrder = await tx.workOrder.create({
      data: { number, year, serial },
    });
    await assignTasksToWorkOrder(tx, workOrder.id, taskIds);
    ordersCreated += 1;
    tasksGrouped += taskIds.length;
  }

  return { ordersCreated, tasksGrouped };
}
