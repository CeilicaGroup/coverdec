import { describe, expect, it } from "vitest";
import {
  computeMaterialCostForUnits,
  computeMaterialCostPerUnit,
} from "../bom-cost";

describe("bom-cost", () => {
  const bom = [
    { quantity: 2.5, unitCost: 12.5 },
    { quantity: 1, unitCost: 45 },
  ];

  it("sums material per unit from BOM lines", () => {
    expect(computeMaterialCostPerUnit(bom)).toBe(76.25);
  });

  it("multiplies per-unit cost by fabrication units", () => {
    expect(computeMaterialCostForUnits(bom, 3)).toBe(228.75);
  });

  it("returns zero for empty BOM or zero units", () => {
    expect(computeMaterialCostForUnits([], 5)).toBe(0);
    expect(computeMaterialCostForUnits(bom, 0)).toBe(0);
  });
});
