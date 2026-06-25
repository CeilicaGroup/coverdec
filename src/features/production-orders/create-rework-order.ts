import {
  ProductionOrderKind,
  ProductionOrderStatus,
  type Prisma,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";

const REWORK_PARENT_STATUSES = new Set<ProductionOrderStatus>([
  ProductionOrderStatus.CURSO,
  ProductionOrderStatus.MULTI,
  ProductionOrderStatus.INT,
  ProductionOrderStatus.CERR,
]);

export function assertCanCreateReworkFromStatus(status: ProductionOrderStatus): void {
  if (!REWORK_PARENT_STATUSES.has(status)) {
    throw new Error(
      "Solo se puede crear retrabajo desde OP en curso, interrumpida, multiday o cerrada.",
    );
  }
}

export function formatReworkOrderNumber(year: number, serial: number): string {
  return `ORT-${year}-${String(serial).padStart(4, "0")}`;
}

export async function allocateReworkSerial(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<number> {
  const last = await tx.productionOrder.findFirst({
    where: { year, kind: ProductionOrderKind.ORT },
    orderBy: { serial: "desc" },
    select: { serial: true },
  });
  return (last?.serial ?? 0) + 1;
}

export async function createReworkOrder(args: {
  parentOrderId: string;
  process?: string;
  hours?: number;
  notes?: string;
}): Promise<{ id: string; number: string }> {
  const parent = await prisma.productionOrder.findUnique({
    where: { id: args.parentOrderId },
    include: {
      lines: {
        where: { lineStatus: "ACTIVE" },
        select: {
          projectId: true,
          clientLabel: true,
          units: true,
          ral: true,
          colorHex: true,
          taskId: true,
        },
      },
    },
  });
  if (!parent) throw new Error("OP padre no encontrada.");
  if (parent.kind === ProductionOrderKind.ORT) {
    throw new Error("No se puede crear retrabajo desde otra ORT.");
  }
  assertCanCreateReworkFromStatus(parent.status);

  const year = new Date().getUTCFullYear();
  const notePrefix = args.notes?.trim()
    ? `[ORT] ${args.notes.trim()}`
    : `[ORT] Retrabajo de ${parent.number}`;

  return prisma.$transaction(async (tx) => {
    const serial = await allocateReworkSerial(tx, year);
    const number = formatReworkOrderNumber(year, serial);

    const order = await tx.productionOrder.create({
      data: {
        number,
        year,
        serial,
        kind: ProductionOrderKind.ORT,
        parentOrderId: parent.id,
        status: ProductionOrderStatus.PEND,
        projectId: parent.projectId,
        lampId: parent.lampId,
        lampLabel: parent.lampLabel,
        process: args.process ?? parent.process,
        hours: args.hours ?? parent.hours,
        naveId: parent.naveId,
        naveKey: parent.naveKey,
        elementTypeId: parent.elementTypeId,
        notes: notePrefix,
        lines: {
          create: parent.lines.map((line) => ({
            projectId: line.projectId,
            clientLabel: line.clientLabel,
            taskId: line.taskId,
            units: line.units,
            ral: line.ral,
            colorHex: line.colorHex,
          })),
        },
      },
    });

    return { id: order.id, number: order.number };
  });
}
