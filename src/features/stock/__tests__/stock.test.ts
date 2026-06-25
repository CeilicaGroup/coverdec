import { describe, expect, it } from "vitest";
import { StockItemState } from "@/generated/prisma";
import { resolveCancelStockState } from "@/features/stock/assign-to-project";

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
