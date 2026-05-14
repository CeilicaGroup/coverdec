import { describe, expect, it } from "vitest";
import { getMondayOf, isoWeek, shiftWeek } from "../week";

describe("week chain for planning gate", () => {
  it("previous ISO week from a Monday is shiftWeek -1", () => {
    const mon = getMondayOf(new Date("2026-05-11T12:00:00Z"));
    expect(isoWeek(mon)).toEqual({ year: 2026, week: 19 });
    const prev = shiftWeek(mon, -1);
    expect(isoWeek(prev)).toEqual({ year: 2026, week: 18 });
  });
});
