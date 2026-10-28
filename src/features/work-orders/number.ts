import type { Prisma } from "@/generated/prisma";

export async function allocateWorkOrderNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear();
  // «Máx + 1» serializado hasta el fin de la transacción: dos OT creadas a la vez
  // no pueden leer el mismo máximo (ni chocar en el índice único).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-order-number:${year}`}))`;
  const last = await tx.workOrder.findFirst({
    where: { year },
    orderBy: { serial: "desc" },
    select: { serial: true },
  });
  const serial = (last?.serial ?? 0) + 1;
  const number = `OT${String(serial).padStart(4, "0")}-${year}`;
  return { year, serial, number };
}
