import { describe, expect, it } from "vitest";
import { assertNoInternalOverlaps, computeTotalHours } from "../manual-ranges";

describe("manual ranges", () => {
  it("computes total hours across ranges", () => {
    const total = computeTotalHours([
      {
        startedAt: new Date("2026-05-11T08:00:00Z"),
        endedAt: new Date("2026-05-11T10:30:00Z"),
      },
      {
        startedAt: new Date("2026-05-11T11:00:00Z"),
        endedAt: new Date("2026-05-11T12:00:00Z"),
      },
    ]);
    expect(total).toBeCloseTo(3.5, 8);
  });

  it("rejects a range where endedAt <= startedAt", () => {
    expect(() =>
      assertNoInternalOverlaps([
        {
          startedAt: new Date("2026-05-11T10:00:00Z"),
          endedAt: new Date("2026-05-11T10:00:00Z"),
        },
      ]),
    ).toThrow(/Rango inválido/i);
  });

  it("rejects internal overlaps", () => {
    expect(() =>
      assertNoInternalOverlaps([
        {
          startedAt: new Date("2026-05-11T08:00:00Z"),
          endedAt: new Date("2026-05-11T10:00:00Z"),
        },
        {
          startedAt: new Date("2026-05-11T09:59:00Z"),
          endedAt: new Date("2026-05-11T11:00:00Z"),
        },
      ]),
    ).toThrow(/solape/i);
  });

  it("accepts touching ranges (end == next start)", () => {
    expect(() =>
      assertNoInternalOverlaps([
        {
          startedAt: new Date("2026-05-11T08:00:00Z"),
          endedAt: new Date("2026-05-11T10:00:00Z"),
        },
        {
          startedAt: new Date("2026-05-11T10:00:00Z"),
          endedAt: new Date("2026-05-11T11:00:00Z"),
        },
      ]),
    ).not.toThrow();
  });
});

