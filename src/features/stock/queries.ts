import { prisma } from "@/lib/db";
import { StockItemState } from "@/generated/prisma";

export interface StockItemRow {
  id: string;
  lampLabel: string;
  elementName: string | null;
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
    state: item.state,
    ral: item.ral,
    colorHex: item.colorHex,
    units: item.units,
    accumulatedMinPerUnit: item.accumulatedMinPerUnit,
    sourceOrderNumber: item.sourceOrder?.number ?? null,
  }));
}
