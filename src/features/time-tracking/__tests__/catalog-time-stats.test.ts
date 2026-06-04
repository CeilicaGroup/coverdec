import { describe, expect, it } from "vitest";
import {
  computeDeviationPct,
  movingAverageFromSamples,
} from "../catalog-time-stats";

describe("movingAverageFromSamples", () => {
  it("averages only the last N samples by completion date", () => {
    const samples = [
      { rate: 1, completedAt: new Date("2026-01-01T10:00:00Z") },
      { rate: 3, completedAt: new Date("2026-02-01T10:00:00Z") },
      { rate: 5, completedAt: new Date("2026-03-01T10:00:00Z") },
      { rate: 7, completedAt: new Date("2026-04-01T10:00:00Z") },
    ];
    const { rates, usedCount, totalCount } = movingAverageFromSamples(samples, 2);
    expect(totalCount).toBe(4);
    expect(usedCount).toBe(2);
    expect(rates).toEqual([7, 5]);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(avg).toBe(6);
  });
});

describe("computeDeviationPct", () => {
  it("returns null when catalog rate is zero", () => {
    expect(computeDeviationPct(0, 1)).toBeNull();
  });

  it("computes absolute percent deviation", () => {
    expect(computeDeviationPct(10, 12)).toBeCloseTo(20);
    expect(computeDeviationPct(10, 8)).toBeCloseTo(20);
  });
});
