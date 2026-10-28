import type { Prisma } from "@/generated/prisma";
import { LampElementStockStatus } from "@/generated/prisma";
import { PRODUCTIVE_SLOTS_PER_DAY } from "@/features/planning/engine/slot-format";
import { syncProjectApprovalStatus } from "@/features/projects/sync-project-approval";
import { deleteEmptyOpenWorkOrders } from "@/features/work-orders/cleanup-empty";
import { lampNameFields } from "@/features/projects/lamp-name-validation";

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
  const lamp = await tx.lamp.findUnique({
    where: { id: args.lampId },
    select: { projectId: true },
  });
  const sourceProjectId = lamp?.projectId;

  await tx.lamp.update({
    where: { id: args.lampId },
    data: { projectId: args.targetProjectId },
  });

  await tx.task.updateMany({
    where: { lampId: args.lampId },
    data: { projectId: args.targetProjectId },
  });

  // Los fichajes siguen a su tarea/lámpara: las horas viajan con la lámpara.
  await tx.timeEntry.updateMany({
    where: { OR: [{ lampId: args.lampId }, { task: { lampId: args.lampId } }] },
    data: { projectId: args.targetProjectId, lampId: args.lampId },
  });

  if (sourceProjectId && sourceProjectId !== args.targetProjectId) {
    await syncProjectApprovalStatus(sourceProjectId, tx);
  }
  await syncProjectApprovalStatus(args.targetProjectId, tx);
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

/**
 * Nombre libre en los proyectos indicados: «Nombre», «Nombre (2)», «Nombre (3)»…
 * Al devolver a stock no se pregunta nombre, así que dos lámparas homónimas
 * (de proyectos distintos o unidades devueltas en dos veces) no pueden chocar en el pool.
 */
export async function freeLampName(
  tx: Prisma.TransactionClient,
  args: { projectIds: string[]; name: string; excludeLampId?: string },
): Promise<{ name: string; nameKey: string }> {
  const rows = await tx.lamp.findMany({
    where: {
      projectId: { in: args.projectIds },
      ...(args.excludeLampId ? { id: { not: args.excludeLampId } } : {}),
    },
    select: { nameKey: true },
  });
  const taken = new Set(rows.map((row) => row.nameKey));
  const base = lampNameFields(args.name);
  if (!taken.has(base.nameKey)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = lampNameFields(`${base.name} (${suffix})`);
    if (!taken.has(candidate.nameKey)) return candidate;
  }
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
