import { describe, expect, it } from "vitest";
import { ProductionOrderKind } from "@/generated/prisma";
import {
  createProductionOrderSchema,
  normalizeCreateProductionOrderLines,
} from "@/features/production-orders/schema";

describe("createProductionOrderSchema", () => {
  it("accepts proyecto with projectId", () => {
    const result = createProductionOrderSchema.safeParse({
      projectId: "proj-1",
      lampLabel: "Cruz",
    });
    expect(result.success).toBe(true);
  });

  it("rejects proyecto without project", () => {
    const result = createProductionOrderSchema.safeParse({
      lampLabel: "Cruz",
    });
    expect(result.success).toBe(false);
  });

  it("accepts stock with elementType and units line", () => {
    const result = createProductionOrderSchema.safeParse({
      kind: ProductionOrderKind.STOCK,
      elementTypeId: "et-1",
      lampLabel: "Cruz",
      process: "IMPRIMACION",
      lines: [{ units: 8 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects stock with projectId", () => {
    const result = createProductionOrderSchema.safeParse({
      kind: ProductionOrderKind.STOCK,
      elementTypeId: "et-1",
      projectId: "proj-1",
      lines: [{ units: 8 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects stock without elementTypeId", () => {
    const result = createProductionOrderSchema.safeParse({
      kind: ProductionOrderKind.STOCK,
      lines: [{ units: 8 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects stock with RAL on line", () => {
    const result = createProductionOrderSchema.safeParse({
      kind: ProductionOrderKind.STOCK,
      elementTypeId: "et-1",
      lines: [{ units: 8, ral: "9005" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("normalizeCreateProductionOrderLines", () => {
  it("normalizes stock lines without project", () => {
    const lines = normalizeCreateProductionOrderLines({
      kind: ProductionOrderKind.STOCK,
      elementTypeId: "et-1",
      lines: [{ units: 8 }],
    });
    expect(lines).toEqual([{ clientLabel: "STOCK", units: 8 }]);
  });
});
