import { describe, expect, it } from "vitest";
import { getMondayOf, isCreatedThisWeek, isoWeek, shiftWeek } from "../week";

describe("week chain for planning gate", () => {
  it("previous ISO week from a Monday is shiftWeek -1", () => {
    const mon = getMondayOf(new Date("2026-05-11T12:00:00Z"));
    expect(isoWeek(mon)).toEqual({ year: 2026, week: 20 });
    const prev = shiftWeek(mon, -1);
    expect(isoWeek(prev)).toEqual({ year: 2026, week: 19 });
  });
});

describe("isoWeek", () => {
  // Referencia: `date +%G-W%V` (ISO 8601).
  it.each([
    ["2024-01-01", 2024, 1],
    ["2024-12-30", 2025, 1],
    ["2025-12-29", 2026, 1],
    ["2026-01-01", 2026, 1],
    ["2026-01-04", 2026, 1],
    ["2026-01-05", 2026, 2],
    ["2026-11-09", 2026, 46],
    ["2027-01-01", 2026, 53],
    ["2027-01-04", 2027, 1],
    ["2021-01-03", 2020, 53],
  ])("%s → %i-W%i", (day, year, week) => {
    expect(isoWeek(new Date(`${day}T12:00:00Z`))).toEqual({ year, week });
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
