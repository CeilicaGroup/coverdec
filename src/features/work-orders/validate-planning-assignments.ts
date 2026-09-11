import type { Prisma } from "@/generated/prisma";
import {
  assertSingleWorkerPerWorkOrder,
  buildTaskWorkerLimitMap,
  buildWorkOrderWorkerLimitMap,
} from "@/features/planning/validate-assignments";

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
      isOverride: true,
      task: {
        select: {
          requiredWorkers: true,
          workOrderId: true,
          workOrder: { select: { number: true, status: true } },
        },
      },
    },
  });

  if (rows.length === 0) return;

  const workOrderIdByTaskId = new Map<string, string>();
  const workOrderNumberById = new Map<string, string>();
  const taskById = new Map<string, { id: string; requiredWorkers: number }>();

  for (const row of rows) {
    const { workOrderId, workOrder, requiredWorkers } = row.task;
    taskById.set(row.taskId, { id: row.taskId, requiredWorkers });
    if (!workOrderId || workOrder?.status === "CLOSED") continue;
    workOrderIdByTaskId.set(row.taskId, workOrderId);
    if (workOrder?.number) workOrderNumberById.set(workOrderId, workOrder.number);
  }

  // Only isOverride rows justify a per-task limit above requiredWorkers — a
  // manual "elegir ejecutores de OT" override, not a solver/merge inconsistency.
  const limitByTaskId = buildTaskWorkerLimitMap(
    [...taskById.values()],
    rows
      .filter((r) => r.isOverride)
      .map((r) => ({ taskId: r.taskId, personId: r.personId })),
  );

  assertSingleWorkerPerWorkOrder(
    rows.map((r) => ({ taskId: r.taskId, personId: r.personId })),
    workOrderIdByTaskId,
    workOrderNumberById,
    { limitByWorkOrderId: buildWorkOrderWorkerLimitMap(limitByTaskId, workOrderIdByTaskId) },
  );
}
