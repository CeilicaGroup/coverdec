import {
  ProductionOrderLineStatus,
  StockItemState,
  TimeEntrySource,
  type Prisma,
} from "@/generated/prisma";
import { isPaintProcess } from "@/features/production-orders/grouping-rules";
import { parseOrderExecutionMeta } from "@/features/production-orders/execution";

const PAINT_PROCESS_CODES = ["PINTURA", "PINT"] as const;

export async function resolvePaintHoursPerUnit(
  tx: Prisma.TransactionClient,
  elementTypeId: string | null,
): Promise<number> {
  if (!elementTypeId) return 0;
  const row = await tx.elementTypeProcess.findFirst({
    where: {
      elementTypeId,
      process: { in: [...PAINT_PROCESS_CODES] },
    },
    select: { hoursPerUnit: true },
  });
  return row?.hoursPerUnit ?? 0;
}

export interface AssignStockArgs {
  stockItemId: string;
  projectId: string;
  units: number;
  ral?: string;
  colorHex?: string;
  userId: string;
}

export async function assignStockToProjectTx(
  tx: Prisma.TransactionClient,
  args: AssignStockArgs,
): Promise<{ stockHours: number; paintHours: number }> {
  const item = await tx.stockItem.findUnique({
    where: { id: args.stockItemId },
    include: { elementType: { select: { name: true } } },
  });
  if (!item) throw new Error("Existencia de almacén no encontrada.");
  if (item.state === StockItemState.ASSIGNED) {
    throw new Error("Esta existencia ya fue asignada.");
  }
  if (args.units > item.units) {
    throw new Error(`Solo hay ${item.units} ud disponibles.`);
  }

  const project = await tx.project.findUnique({
    where: { id: args.projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Proyecto no encontrado.");

  let ral = args.ral?.trim() ?? item.ral?.trim() ?? "";
  if (item.state === StockItemState.CON_COLOR) {
    if (!item.ral) throw new Error("La existencia con color no tiene RAL registrado.");
    if (ral && ral !== item.ral) {
      throw new Error("El RAL del proyecto debe coincidir con el stock con color.");
    }
    ral = item.ral;
  } else if (!ral) {
    throw new Error("Indica el RAL del proyecto para asignar stock imprimado.");
  }

  const colorHex = args.colorHex ?? item.colorHex;
  const stockHours = Math.round(((item.accumulatedMinPerUnit * args.units) / 60) * 100) / 100;
  const paintHoursPerUnit = await resolvePaintHoursPerUnit(tx, item.elementTypeId);
  const paintHours = Math.round(paintHoursPerUnit * args.units * 100) / 100;

  const label = item.lampLabel ?? item.elementType?.name ?? "elemento";
  const now = new Date();

  if (stockHours > 0) {
    await tx.timeEntry.create({
      data: {
        userId: args.userId,
        projectId: project.id,
        process: "IMPRIMACION",
        source: TimeEntrySource.MANUAL,
        startedAt: now,
        endedAt: now,
        hours: stockHours,
        notes: `Asignación desde STOCK · ${label} · ${args.units} ud`,
      },
    });
  }

  if (paintHours > 0) {
    await tx.timeEntry.create({
      data: {
        userId: args.userId,
        projectId: project.id,
        process: "PINTURA",
        source: TimeEntrySource.MANUAL,
        startedAt: now,
        endedAt: now,
        hours: paintHours,
        notes: `Pintura estimada · RAL ${ral} · ${args.units} ud`,
      },
    });
  }

  if (args.units === item.units) {
    await tx.stockItem.update({
      where: { id: item.id },
      data: {
        state: StockItemState.ASSIGNED,
        ral,
        colorHex,
        units: args.units,
      },
    });
  } else {
    await tx.stockItem.update({
      where: { id: item.id },
      data: { units: item.units - args.units },
    });
    await tx.stockItem.create({
      data: {
        elementTypeId: item.elementTypeId,
        lampLabel: item.lampLabel,
        state: StockItemState.ASSIGNED,
        ral,
        colorHex,
        units: args.units,
        accumulatedMinPerUnit: item.accumulatedMinPerUnit,
        sourceOrderId: item.sourceOrderId,
        sourceLineId: item.sourceLineId,
      },
    });
  }

  return { stockHours, paintHours };
}

export function resolveCancelStockState(args: {
  step: number;
  orderProcess: string | null;
  orderStatus: string;
  lineRal: string | null;
}): StockItemState | null {
  if (args.step === 0) return null;
  const painted =
    Boolean(args.lineRal?.trim()) &&
    (args.orderStatus === "CERR" ||
      (args.orderProcess != null && isPaintProcess(args.orderProcess)));
  return painted ? StockItemState.CON_COLOR : StockItemState.IMPRIMADO;
}

export interface CancelLineArgs {
  orderId: string;
  lineId: string;
  unitsToCancel: number;
  userId: string;
}

export async function cancelProductionOrderLineTx(
  tx: Prisma.TransactionClient,
  args: CancelLineArgs,
): Promise<{ movedToStock: boolean; stockState: StockItemState | null }> {
  const order = await tx.productionOrder.findUnique({
    where: { id: args.orderId },
    include: {
      lines: {
        where: { id: args.lineId, lineStatus: ProductionOrderLineStatus.ACTIVE },
      },
    },
  });
  if (!order) throw new Error("Orden de producción no encontrada.");
  const line = order.lines[0];
  if (!line) throw new Error("Línea no encontrada o ya cancelada.");
  if (args.unitsToCancel > line.units) {
    throw new Error(`Solo puedes cancelar hasta ${line.units} ud.`);
  }

  const stockState = resolveCancelStockState({
    step: order.step,
    orderProcess: order.process,
    orderStatus: order.status,
    lineRal: line.ral,
  });

  const remaining = line.units - args.unitsToCancel;

  if (stockState != null) {
    const { meta } = parseOrderExecutionMeta(order.notes);
    const activeUnits = await tx.productionOrderLine.aggregate({
      where: { orderId: order.id, lineStatus: ProductionOrderLineStatus.ACTIVE },
      _sum: { units: true },
    });
    const totalUnits = activeUnits._sum.units ?? line.units;
    const minPerUnit =
      totalUnits > 0
        ? meta.actualHours > 0
          ? (meta.actualHours * 60) / totalUnits
          : ((order.hours ?? 0) * 60) / totalUnits
        : 0;

    await tx.stockItem.create({
      data: {
        elementTypeId: order.elementTypeId,
        lampLabel: order.lampLabel,
        state: stockState,
        ral: stockState === StockItemState.CON_COLOR ? line.ral : null,
        colorHex: stockState === StockItemState.CON_COLOR ? line.colorHex : null,
        units: args.unitsToCancel,
        accumulatedMinPerUnit: minPerUnit,
        sourceOrderId: order.id,
        sourceLineId: line.id,
      },
    });

    const transferHours = Math.round(((minPerUnit * args.unitsToCancel) / 60) * 100) / 100;
    if (transferHours > 0 && line.projectId) {
      const project = await tx.project.findUnique({
        where: { id: line.projectId },
        select: { name: true },
      });
      await tx.timeEntry.create({
        data: {
          userId: args.userId,
          projectId: line.projectId,
          process: order.process ?? undefined,
          source: TimeEntrySource.MANUAL,
          startedAt: new Date(),
          endedAt: new Date(),
          hours: transferHours,
          notes: `Cancelación → STOCK · ${project?.name ?? line.projectId} · ${args.unitsToCancel} ud`,
        },
      });
    }
  }

  if (remaining === 0) {
    await tx.productionOrderLine.update({
      where: { id: line.id },
      data: { units: 0, lineStatus: ProductionOrderLineStatus.CANCELLED },
    });
  } else {
    await tx.productionOrderLine.update({
      where: { id: line.id },
      data: { units: remaining },
    });
  }

  return { movedToStock: stockState != null, stockState };
}
