import type { Prisma } from "@/generated/prisma";

export async function allocateWorkOrderNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear();
  const last = await tx.workOrder.findFirst({
    where: { year },
    orderBy: { serial: "desc" },
    select: { serial: true },
  });
  const serial = (last?.serial ?? 0) + 1;
  const number = `OT${String(serial).padStart(4, "0")}-${year}`;
  return { year, serial, number };
}
