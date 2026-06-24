import {
  ProductionOrderKind,
  ProductionOrderLineStatus,
  StockItemState,
  type Prisma,
} from "@/generated/prisma";
import {
  isPaintProcess,
  isPrimerProcess,
} from "@/features/production-orders/grouping-rules";
import { parseOrderExecutionMeta } from "@/features/production-orders/execution";

type OrderWithLines = {
  id: string;
  kind: ProductionOrderKind;
  process: string | null;
  elementTypeId: string | null;
  lampLabel: string | null;
  notes: string | null;
  lines: {
    id: string;
    units: number;
    completedUnits: number;
    lineStatus: ProductionOrderLineStatus;
    projectId: string | null;
    ral: string | null;
    colorHex: string | null;
  }[];
};

/** Tras confirmar imprimación en OP stock, crea semielaborados en almacén. */
export async function createStockItemsFromPrimedOrder(
  tx: Prisma.TransactionClient,
  order: OrderWithLines,
): Promise<number> {
  if (order.kind !== ProductionOrderKind.STOCK) return 0;
  if (!order.process || !isPrimerProcess(order.process)) return 0;

  const activeLines = order.lines.filter(
    (l) => l.lineStatus === ProductionOrderLineStatus.ACTIVE && l.units > 0,
  );
  if (activeLines.length === 0) return 0;

  const { meta } = parseOrderExecutionMeta(order.notes);
  const totalUnits = activeLines.reduce((s, l) => s + l.units, 0);
  const minPerUnit = totalUnits > 0 ? (meta.actualHours * 60) / totalUnits : 0;

  let created = 0;
  for (const line of activeLines) {
    await tx.stockItem.create({
      data: {
        elementTypeId: order.elementTypeId,
        lampLabel: order.lampLabel,
        state: StockItemState.IMPRIMADO,
        units: line.units,
        accumulatedMinPerUnit: minPerUnit,
        sourceOrderId: order.id,
        sourceLineId: line.id,
      },
    });
    created += 1;
  }
  return created;
}

export function assertStockOrderCanStartPaint(order: {
  kind: ProductionOrderKind;
  process: string | null;
  lines: { ral: string | null; units: number }[];
}): void {
  if (order.kind !== ProductionOrderKind.STOCK) return;
  if (!order.process || !isPaintProcess(order.process)) return;
  const hasRal = order.lines.some((l) => l.units > 0 && l.ral?.trim());
  if (!hasRal) {
    throw new Error(
      "Las OP de stock no pueden iniciar pintura sin RAL asignado desde proyecto.",
    );
  }
}
