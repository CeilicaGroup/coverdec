import { describe, expect, it } from "vitest";
import { mergeHoursByDay, sumPlannedHoursByDay } from "../queries";

describe("planning occupancy helpers", () => {
  it("merges hour maps by day", () => {
    const a = new Map([["2026-05-25", 4]]);
    const b = new Map([["2026-05-25", 2], ["2026-05-26", 3]]);
    expect(mergeHoursByDay(a, b).get("2026-05-25")).toBe(6);
    expect(mergeHoursByDay(a, b).get("2026-05-26")).toBe(3);
  });

  it("sums assignments into daily totals", () => {
    const result = sumPlannedHoursByDay([
      { date: new Date("2026-05-25T00:00:00.000Z"), hours: 3 },
      { date: new Date("2026-05-25T00:00:00.000Z"), hours: 2 },
    ]);
    expect(result.totalHours).toBe(5);
    expect(result.byDay.get("2026-05-25")).toBe(5);
  });
});
