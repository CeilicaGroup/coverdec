import { describe, expect, it } from "vitest";
import {
  buildWeeklyScheduleFromWorkWindows,
  computePersonDayCapacityHours,
} from "../person-day-capacity";

describe("computePersonDayCapacityHours", () => {
  const monday = new Date("2026-05-25T00:00:00.000Z");

  const weekly = buildWeeklyScheduleFromWorkWindows([
    { dayOfWeek: 1, startMinutes: 8 * 60, endMinutes: 12 * 60 },
    { dayOfWeek: 1, startMinutes: 15 * 60, endMinutes: 17 * 60 },
  ]);

  it("returns 0 on holidays", () => {
    expect(
      computePersonDayCapacityHours({
        day: monday,
        weekly,
        overrides: [],
        absenceHours: 0,
        isHoliday: true,
      }),
    ).toBe(0);
  });

  it("uses per-day schedule windows", () => {
    expect(
      computePersonDayCapacityHours({
        day: monday,
        weekly,
        overrides: [],
        absenceHours: 0,
        isHoliday: false,
      }),
    ).toBe(6);
  });

  it("subtracts absence hours from scheduled capacity", () => {
    expect(
      computePersonDayCapacityHours({
        day: monday,
        weekly,
        overrides: [],
        absenceHours: 2,
        isHoliday: false,
      }),
    ).toBe(4);
  });

  it("honours schedule override with empty windows", () => {
    expect(
      computePersonDayCapacityHours({
        day: monday,
        weekly,
        overrides: [{ date: monday, windows: [] }],
        absenceHours: 0,
        isHoliday: false,
      }),
    ).toBe(0);
  });

  it("Saturday only counts with an override or its own weekly schedule", () => {
    const saturday = new Date("2026-05-30T00:00:00.000Z");
    const base = { day: saturday, weekly, absenceHours: 0, isHoliday: false };
    expect(computePersonDayCapacityHours({ ...base, overrides: [] })).toBe(0);
    expect(
      computePersonDayCapacityHours({
        ...base,
        overrides: [{ date: saturday, windows: [{ startMinutes: 8 * 60, endMinutes: 14 * 60 }] }],
      }),
    ).toBe(6);
  });
});
