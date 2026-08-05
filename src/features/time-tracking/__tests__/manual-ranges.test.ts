import { describe, expect, it } from "vitest";
import { fromDatetimeLocalInputValue } from "@/lib/datetime-local";
import {
  assertNoFutureCalendarDays,
  assertNoInternalOverlaps,
  computeTotalHours,
  FUTURE_CALENDAR_DAY_ERROR,
} from "../manual-ranges";

/** Fixed "now" = 27 Jul 2026 10:00 Europe/Madrid. */
const now = new Date(fromDatetimeLocalInputValue("2026-07-27T10:00"));

function madridRange(start: string, end: string) {
  return {
    startedAt: new Date(fromDatetimeLocalInputValue(start)),
    endedAt: new Date(fromDatetimeLocalInputValue(end)),
  };
}

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

describe("assertNoFutureCalendarDays", () => {
  it("allows same-day ranges including hours after now", () => {
    expect(() =>
      assertNoFutureCalendarDays(
        [madridRange("2026-07-27T10:00", "2026-07-27T18:00")],
        now,
      ),
    ).not.toThrow();
  });

  it("allows past days", () => {
    expect(() =>
      assertNoFutureCalendarDays(
        [madridRange("2026-07-26T08:00", "2026-07-26T12:00")],
        now,
      ),
    ).not.toThrow();
  });

  it("rejects a range on a future calendar day", () => {
    expect(() =>
      assertNoFutureCalendarDays(
        [madridRange("2026-07-28T08:00", "2026-07-28T10:00")],
        now,
      ),
    ).toThrow(FUTURE_CALENDAR_DAY_ERROR);
  });

  it("rejects a range that ends on a future calendar day", () => {
    expect(() =>
      assertNoFutureCalendarDays(
        [madridRange("2026-07-27T22:00", "2026-07-28T01:00")],
        now,
      ),
    ).toThrow(FUTURE_CALENDAR_DAY_ERROR);
  });
});
