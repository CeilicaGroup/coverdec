import type { Prisma } from "@/generated/prisma";
import { assertSingleWorkerPerWorkOrder } from "@/features/planning/validate-assignments";

type Tx = Prisma.TransactionClient;

export async function assertPlanningAssignmentsWorkOrderWorkers(
  tx: Tx,
  planningId: string,
): Promise<void> {
  const rows = await tx.planningAssignment.findMany({
    where: { planningId },
    select: {
      taskId: true,
      personId: true,
      task: {
        select: {
          workOrderId: true,
          workOrder: { select: { number: true, status: true } },
        },
      },
    },
  });

  if (rows.length === 0) return;

  const workOrderIdByTaskId = new Map<string, string>();
  const workOrderNumberById = new Map<string, string>();

  for (const row of rows) {
    const { workOrderId, workOrder } = row.task;
    if (!workOrderId || workOrder?.status === "CLOSED") continue;
    workOrderIdByTaskId.set(row.taskId, workOrderId);
    if (workOrder?.number) workOrderNumberById.set(workOrderId, workOrder.number);
  }

  assertSingleWorkerPerWorkOrder(
    rows.map((r) => ({ taskId: r.taskId, personId: r.personId })),
    workOrderIdByTaskId,
    workOrderNumberById,
  );
}
