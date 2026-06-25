import { describe, expect, it } from "vitest";
import { ProductionOrderKind, StockItemState } from "@/generated/prisma";
import { resolveCancelStockState } from "@/features/stock/assign-to-project";
import { assertStockOrderCanStartPaint } from "@/features/stock/create-from-order";

describe("assertStockOrderCanStartPaint", () => {
  it("blocks paint on stock without RAL", () => {
    expect(() =>
      assertStockOrderCanStartPaint({
        kind: ProductionOrderKind.STOCK,
        process: "PINTURA",
        lines: [{ ral: null, units: 8 }],
      }),
    ).toThrow(/RAL/);
  });

  it("allows paint on stock when line has RAL", () => {
    expect(() =>
      assertStockOrderCanStartPaint({
        kind: ProductionOrderKind.STOCK,
        process: "PINTURA",
        lines: [{ ral: "9005", units: 8 }],
      }),
    ).not.toThrow();
  });
});


describe("resolveCancelStockState", () => {
  it("returns null before fabrication", () => {
    expect(
      resolveCancelStockState({
        step: 0,
        orderProcess: "CNC",
        orderStatus: "CURSO",
        lineRal: null,
      }),
    ).toBeNull();
  });

  it("returns IMPRIMADO when in process without paint", () => {
    expect(
      resolveCancelStockState({
        step: 2,
        orderProcess: "IMPRIMACION",
        orderStatus: "MULTI",
        lineRal: null,
      }),
    ).toBe(StockItemState.IMPRIMADO);
  });

  it("returns CON_COLOR when line has RAL on paint process", () => {
    expect(
      resolveCancelStockState({
        step: 1,
        orderProcess: "PINTURA",
        orderStatus: "CURSO",
        lineRal: "9005",
      }),
    ).toBe(StockItemState.CON_COLOR);
  });

  it("returns CON_COLOR when closed with RAL", () => {
    expect(
      resolveCancelStockState({
        step: 3,
        orderProcess: "ENSAMBLAJE",
        orderStatus: "CERR",
        lineRal: "6018",
      }),
    ).toBe(StockItemState.CON_COLOR);
  });
});
