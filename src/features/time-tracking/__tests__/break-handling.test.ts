import { describe, expect, it } from "vitest";
import {
  applyBreakHandling,
  summarizeBreakOverlap,
  type BreakScheduleContext,
} from "../break-handling";

const schedule: BreakScheduleContext = {
  weekly: [
    {
      dayOfWeek: 1,
      windows: [
        { startMinutes: 8 * 60, endMinutes: 14 * 60 },
        { startMinutes: 15 * 60, endMinutes: 17 * 60 },
      ],
    },
  ],
  overrides: [],
};

describe("break handling for manual ranges", () => {
  it("detects overlap with midday break", () => {
    const summary = summarizeBreakOverlap(
      [
        {
          startedAt: new Date("2026-07-20T13:30:00.000Z"),
          endedAt: new Date("2026-07-20T15:30:00.000Z"),
        },
      ],
      schedule,
    );

    expect(summary.hasOverlap).toBe(true);
    expect(summary.overlapMinutes).toBe(60);
  });

  it("keeps range when user marks worked_extra", () => {
    const result = applyBreakHandling(
      [
        {
          startedAt: new Date("2026-07-20T13:30:00.000Z"),
          endedAt: new Date("2026-07-20T15:30:00.000Z"),
        },
      ],
      schedule,
      "worked_extra",
    );

    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.startedAt.toISOString()).toBe("2026-07-20T13:30:00.000Z");
    expect(result.ranges[0]?.endedAt.toISOString()).toBe("2026-07-20T15:30:00.000Z");
  });

  it("cuts out break segment when user marks took_break", () => {
    const result = applyBreakHandling(
      [
        {
          startedAt: new Date("2026-07-20T13:30:00.000Z"),
          endedAt: new Date("2026-07-20T15:30:00.000Z"),
        },
      ],
      schedule,
      "took_break",
    );

    expect(result.ranges).toHaveLength(2);
    expect(result.ranges[0]?.startedAt.toISOString()).toBe("2026-07-20T13:30:00.000Z");
    expect(result.ranges[0]?.endedAt.toISOString()).toBe("2026-07-20T14:00:00.000Z");
    expect(result.ranges[1]?.startedAt.toISOString()).toBe("2026-07-20T15:00:00.000Z");
    expect(result.ranges[1]?.endedAt.toISOString()).toBe("2026-07-20T15:30:00.000Z");
  });

  it("throws when overlap exists and no decision is provided", () => {
    expect(() =>
      applyBreakHandling(
        [
          {
            startedAt: new Date("2026-07-20T13:30:00.000Z"),
            endedAt: new Date("2026-07-20T15:30:00.000Z"),
          },
        ],
        schedule,
      ),
    ).toThrow(/trabajo extra o descanso/i);
  });
});
