import type { Prisma } from "@/generated/prisma";
import { WorkOrderStatus } from "@/generated/prisma";
import { allocateWorkOrderNumber } from "@/features/work-orders/number";
import { IMPREVISTA_PROCESS_CODE } from "./constants";

export async function findOrCreateOpenImprevistaWorkOrder(
  tx: Prisma.TransactionClient,
) {
  const existing = await tx.workOrder.findFirst({
    where: {
      status: WorkOrderStatus.OPEN,
      tasks: { some: { process: IMPREVISTA_PROCESS_CODE } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  const { year, serial, number } = await allocateWorkOrderNumber(tx);
  return tx.workOrder.create({
    data: {
      year,
      serial,
      number,
      notes: "OT imprevistas",
    },
  });
}
