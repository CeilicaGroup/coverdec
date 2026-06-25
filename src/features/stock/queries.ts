import { prisma } from "@/lib/db";
import { ProductionOrderLineStatus, StockItemState } from "@/generated/prisma";
import { resolveCancelStockState } from "./assign-to-project";

export interface StockItemRow {
  id: string;
  lampLabel: string;
  elementName: string | null;
  elementTypeId: string | null;
  state: StockItemState;
  ral: string | null;
  colorHex: string | null;
  units: number;
  accumulatedMinPerUnit: number;
  sourceOrderNumber: string | null;
}

const STATE_LABELS: Record<StockItemState, string> = {
  IMPRIMADO: "Imprimado",
  CON_COLOR: "Stock con color",
  ASSIGNED: "Asignado a proyecto",
};

export { STATE_LABELS };

export async function loadStockItems(): Promise<StockItemRow[]> {
  const items = await prisma.stockItem.findMany({
    where: { state: { not: StockItemState.ASSIGNED } },
    include: {
      elementType: { select: { name: true } },
      sourceOrder: { select: { number: true } },
    },
    orderBy: [{ state: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return items.map((item) => ({
    id: item.id,
    lampLabel: item.lampLabel ?? item.elementType?.name ?? "—",
    elementName: item.elementType?.name ?? null,
    elementTypeId: item.elementTypeId,
    state: item.state,
    ral: item.ral,
    colorHex: item.colorHex,
    units: item.units,
    accumulatedMinPerUnit: item.accumulatedMinPerUnit,
    sourceOrderNumber: item.sourceOrder?.number ?? null,
  }));
}

export interface CancelCandidateRow {
  lineId: string;
  orderId: string;
  orderNumber: string;
  projectName: string;
  units: number;
  ral: string | null;
  step: number;
  process: string | null;
  status: string;
  cancelHint: string;
}

export async function loadCancelCandidates(): Promise<CancelCandidateRow[]> {
  const lines = await prisma.productionOrderLine.findMany({
    where: {
      lineStatus: ProductionOrderLineStatus.ACTIVE,
      projectId: { not: null },
      units: { gt: 0 },
    },
    include: {
      project: { select: { name: true } },
      order: {
        select: {
          id: true,
          number: true,
          step: true,
          status: true,
          process: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return lines.map((line) => {
    const stockState = resolveCancelStockState({
      step: line.order.step,
      orderProcess: line.order.process,
      orderStatus: line.order.status,
      lineRal: line.ral,
    });
    let cancelHint =
      "Antes de fabricar: se reduce la OP sin mover almacén.";
    if (stockState === StockItemState.IMPRIMADO) {
      cancelHint =
        "En proceso sin pintura: las unidades pasan a stock imprimado (cualquier RAL).";
    } else if (stockState === StockItemState.CON_COLOR) {
      cancelHint =
        "Ya pintado: pasan a stock con color, reutilizables solo con el mismo RAL.";
    }
    return {
      lineId: line.id,
      orderId: line.order.id,
      orderNumber: line.order.number,
      projectName: line.project?.name ?? "—",
      units: line.units,
      ral: line.ral,
      step: line.order.step,
      process: line.order.process,
      status: line.order.status,
      cancelHint,
    };
  });
}

export function stockItemsAssignable(items: StockItemRow[]): StockItemRow[] {
  return items.filter(
    (i) =>
      i.state === StockItemState.IMPRIMADO || i.state === StockItemState.CON_COLOR,
  );
}

