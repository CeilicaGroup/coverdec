import { describe, expect, it } from "vitest";
import {
  distributeHoursByEstimatedHours,
  distributeHoursByMeasure,
  splitRangesByTaskHours,
  taskMeasureForGroupedOt,
} from "../grouped-ot";

describe("grouped ot distribution", () => {
  it("uses lampElement surface * units when available", () => {
    expect(
      taskMeasureForGroupedOt({
        lamp: { surfaceM2: 2, units: 1 },
        lampElement: { surfaceM2: 1.5, units: 3 },
      }),
    ).toBe(4.5);
  });

  it("distributes proportionally and preserves exact total hours", () => {
    const distributed = distributeHoursByMeasure(5, [
      { lamp: { surfaceM2: 1, units: 1 }, lampElement: null },
      { lamp: { surfaceM2: 2, units: 1 }, lampElement: null },
    ]);
    expect(distributed[0]).toBeCloseTo(1.666667, 6);
    expect(distributed[1]).toBeCloseTo(3.333333, 6);
    expect(distributed.reduce((sum, value) => sum + value, 0)).toBeCloseTo(5, 6);
  });

  it("falls back to uniform distribution when no measures are available", () => {
    const distributed = distributeHoursByMeasure(3, [
      { lamp: { surfaceM2: null, units: 1 }, lampElement: null },
      { lamp: { surfaceM2: null, units: 1 }, lampElement: null },
      { lamp: null, lampElement: null },
    ]);
    expect(distributed[0]).toBeCloseTo(1, 8);
    expect(distributed[1]).toBeCloseTo(1, 8);
    expect(distributed[2]).toBeCloseTo(1, 8);
  });

  it("distributes by estimated hours like the OT product example", () => {
    const distributed = distributeHoursByEstimatedHours(6, [
      { estimatedHours: 3 },
      { estimatedHours: 2 },
      { estimatedHours: 1.5 },
    ]);
    expect(distributed[0]).toBeCloseTo(2.769231, 5);
    expect(distributed[1]).toBeCloseTo(1.846154, 5);
    expect(distributed[2]).toBeCloseTo(1.384615, 5);
    expect(distributed.reduce((sum, value) => sum + value, 0)).toBeCloseTo(6, 6);
  });

  it("falls back to uniform distribution when estimated hours are zero", () => {
    const distributed = distributeHoursByEstimatedHours(3, [
      { estimatedHours: 0 },
      { estimatedHours: 0 },
      { estimatedHours: 0 },
    ]);
    expect(distributed[0]).toBeCloseTo(1, 8);
    expect(distributed[1]).toBeCloseTo(1, 8);
    expect(distributed[2]).toBeCloseTo(1, 8);
  });

  it("splits timeline ranges according to assigned task hours", () => {
    const allocations = splitRangesByTaskHours(
      [
        {
          startedAt: new Date("2026-01-01T08:00:00.000Z"),
          endedAt: new Date("2026-01-01T09:00:00.000Z"),
        },
        {
          startedAt: new Date("2026-01-01T10:00:00.000Z"),
          endedAt: new Date("2026-01-01T12:00:00.000Z"),
        },
      ],
      [1.5, 1.5],
    );
    expect(allocations).toHaveLength(2);
    expect(allocations[0].reduce((sum, segment) => sum + segment.hours, 0)).toBeCloseTo(1.5, 8);
    expect(allocations[1].reduce((sum, segment) => sum + segment.hours, 0)).toBeCloseTo(1.5, 8);
    const total = allocations
      .flat()
      .reduce((sum, segment) => sum + segment.hours, 0);
    expect(total).toBeCloseTo(3, 8);
  });
});
