import { describe, expect, it } from "vitest";
import { getMondayOf, isCreatedThisWeek, isoWeek, shiftWeek } from "../week";

describe("week chain for planning gate", () => {
  it("previous ISO week from a Monday is shiftWeek -1", () => {
    const mon = getMondayOf(new Date("2026-05-11T12:00:00Z"));
    expect(isoWeek(mon)).toEqual({ year: 2026, week: 19 });
    const prev = shiftWeek(mon, -1);
    expect(isoWeek(prev)).toEqual({ year: 2026, week: 18 });
  });
});

describe("isCreatedThisWeek", () => {
  const now = new Date("2026-05-13T10:00:00Z"); // Wednesday

  it("is true for a date on Monday of the current week", () => {
    expect(isCreatedThisWeek(new Date("2026-05-11T00:00:00Z"), now)).toBe(true);
  });

  it("is true for a date later in the current week", () => {
    expect(isCreatedThisWeek(new Date("2026-05-13T09:00:00Z"), now)).toBe(true);
  });

  it("is false for a date before Monday of the current week", () => {
    expect(isCreatedThisWeek(new Date("2026-05-10T23:59:59Z"), now)).toBe(false);
  });
});
