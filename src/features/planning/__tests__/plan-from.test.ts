import { describe, expect, it } from "vitest";
import {
  computePlanFromBounds,
  resolvePlanFromAnchor,
} from "../plan-from";

const weekStart = new Date("2026-05-04T00:00:00.000Z");

describe("resolvePlanFromAnchor", () => {
  it("WEEK_START is monday of the viewed week", () => {
    const at = new Date("2026-05-07T14:00:00.000Z");
    expect(resolvePlanFromAnchor(weekStart, "WEEK_START", at).toISOString()).toBe(
      weekStart.toISOString(),
    );
  });

  it("TOMORROW is next calendar day from planFromAt", () => {
    const at = new Date("2026-05-07T14:00:00.000Z");
    expect(resolvePlanFromAnchor(weekStart, "TOMORROW", at).toISOString()).toBe(
      "2026-05-08T00:00:00.000Z",
    );
  });
});

describe("computePlanFromBounds", () => {
  it("TODAY midweek starts on wednesday without quarter", () => {
    const at = new Date("2026-05-06T10:15:00.000Z");
    expect(computePlanFromBounds(weekStart, "TODAY", at)).toEqual({
      firstSchedulableDayIndex: 2,
    });
  });

  it("NOW on wednesday adds week quarter", () => {
    const at = new Date("2026-05-06T10:15:00.000Z");
    const bounds = computePlanFromBounds(weekStart, "NOW", at);
    expect(bounds.firstSchedulableDayIndex).toBe(2);
    expect(bounds.firstSchedulableWeekQuarter).toBe(2 * 24 * 4 + Math.floor((10 * 60 + 15) / 15));
  });

  it("TOMORROW from thursday anchors friday at midnight", () => {
    const at = new Date("2026-05-07T16:00:00.000Z");
    expect(computePlanFromBounds(weekStart, "TOMORROW", at)).toEqual({
      firstSchedulableDayIndex: 4,
    });
  });

  it("returns no schedulable days when anchor is after the work week", () => {
    const at = new Date("2026-05-10T12:00:00.000Z");
    expect(computePlanFromBounds(weekStart, "TODAY", at)).toEqual({
      firstSchedulableDayIndex: 5,
    });
  });
});
