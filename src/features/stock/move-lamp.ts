import type { Prisma } from "@/generated/prisma";
import { LampElementStockStatus } from "@/generated/prisma";
import { PRODUCTIVE_SLOTS_PER_DAY } from "@/features/planning/engine/slot-format";
import { deleteEmptyOpenWorkOrders } from "@/features/work-orders/cleanup-empty";

export function formatStockBatchCode(year: number, serial: number): string {
  return `SB-${String(serial).padStart(4, "0")}-${year}`;
}

export function parseStockBatchSerial(code: string, year: number): number | null {
  const match = /^SB-(\d{4})-(\d{4})$/.exec(code);
  if (!match) return null;
  const serial = Number(match[1]);
  const codeYear = Number(match[2]);
  if (codeYear !== year || !Number.isFinite(serial)) return null;
  return serial;
}

export function lampReturnToStockFields(args: {
  previousProjectId: string;
  reason?: string;
}): {
  returnedToStockAt: Date;
  returnedToStockReason: string | null;
  previousProjectId: string;
} {
  return {
    returnedToStockAt: new Date(),
    returnedToStockReason: args.reason?.trim() || null,
    previousProjectId: args.previousProjectId,
  };
}

export function lampAssignFromStockFields(): {
  returnedToStockAt: null;
  returnedToStockReason: null;
  previousProjectId: null;
} {
  return {
    returnedToStockAt: null,
    returnedToStockReason: null,
    previousProjectId: null,
  };
}

export function stockElementStatusForReturn(): LampElementStockStatus {
  return LampElementStockStatus.AVAILABLE;
}

export function stockElementStatusForAssign(): LampElementStockStatus {
  return LampElementStockStatus.ASSIGNED;
}

export function stockElementStatusForProduction(): LampElementStockStatus {
  return LampElementStockStatus.IN_PRODUCTION;
}

export function computeNextSlotForPersonDay(
  existingEndSlots: number[],
  hours: number,
): { startSlot: number; endSlot: number; isAfternoon: boolean } {
  const startSlot =
    existingEndSlots.length > 0 ? Math.max(...existingEndSlots) : 0;
  const endSlot = Math.min(startSlot + hours, PRODUCTIVE_SLOTS_PER_DAY);
  const isAfternoon = startSlot >= 6;
  return { startSlot, endSlot, isAfternoon };
}

export async function moveLampToProject(
  tx: Prisma.TransactionClient,
  args: { lampId: string; targetProjectId: string },
): Promise<void> {
  await tx.lamp.update({
    where: { id: args.lampId },
    data: { projectId: args.targetProjectId },
  });

  await tx.task.updateMany({
    where: { lampId: args.lampId },
    data: { projectId: args.targetProjectId },
  });
}

export async function clearPendingTaskWorkOrders(
  tx: Prisma.TransactionClient,
  lampId: string,
): Promise<void> {
  const linked = await tx.task.findMany({
    where: { lampId, isCompleted: false, workOrderId: { not: null } },
    select: { workOrderId: true },
  });
  const workOrderIds = [
    ...new Set(
      linked
        .map((task) => task.workOrderId)
        .filter((id): id is string => id != null),
    ),
  ];

  await tx.task.updateMany({
    where: { lampId, isCompleted: false },
    data: { workOrderId: null, workOrderSequence: null },
  });

  await deleteEmptyOpenWorkOrders(tx, workOrderIds);
}

export async function deletePlanningAssignmentsForLamp(
  tx: Prisma.TransactionClient,
  lampId: string,
): Promise<number> {
  const result = await tx.planningAssignment.deleteMany({
    where: { task: { lampId } },
  });
  return result.count;
}

export async function nextStockBatchCode(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await tx.lampElement.findMany({
    where: { stockBatchCode: { not: null } },
    select: { stockBatchCode: true },
  });

  let maxSerial = 0;
  for (const row of rows) {
    if (!row.stockBatchCode) continue;
    const serial = parseStockBatchSerial(row.stockBatchCode, year);
    if (serial != null) maxSerial = Math.max(maxSerial, serial);
  }

  return formatStockBatchCode(year, maxSerial + 1);
}
