import { describe, expect, it } from "vitest";
import { ProductionOrderKind } from "@/generated/prisma";

const STANDARD_KINDS = new Set<ProductionOrderKind>([
  ProductionOrderKind.PROYECTO,
  ProductionOrderKind.STOCK,
]);

describe("plan-vs-real standard kinds", () => {
  it("excludes ORT from standard project cost aggregation", () => {
    expect(STANDARD_KINDS.has(ProductionOrderKind.ORT)).toBe(false);
    expect(STANDARD_KINDS.has(ProductionOrderKind.PROYECTO)).toBe(true);
  });
});
