import { describe, expect, it } from "vitest";
import { fromDatetimeLocalInputValue } from "@/lib/datetime-local";
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

/** Monday 2026-07-20 wall-clock Europe/Madrid → UTC Date. */
function madrid(time: string): Date {
  return new Date(fromDatetimeLocalInputValue(`2026-07-20T${time}`));
}

describe("break handling for manual ranges", () => {
  it("detects overlap with midday break", () => {
    const summary = summarizeBreakOverlap(
      [{ startedAt: madrid("13:30"), endedAt: madrid("15:30") }],
      schedule,
    );

    expect(summary.hasOverlap).toBe(true);
    expect(summary.overlapMinutes).toBe(60);
  });

  it("does not flag afternoon-only range after the break", () => {
    const summary = summarizeBreakOverlap(
      [{ startedAt: madrid("15:30"), endedAt: madrid("17:00") }],
      schedule,
    );

    expect(summary.hasOverlap).toBe(false);
    expect(summary.overlapMinutes).toBe(0);
  });

  it("detects full-day range that spans the lunch break", () => {
    const summary = summarizeBreakOverlap(
      [{ startedAt: madrid("12:00"), endedAt: madrid("17:00") }],
      schedule,
    );

    expect(summary.hasOverlap).toBe(true);
    expect(summary.overlapMinutes).toBe(60);
  });

  it("keeps range when user marks worked_extra", () => {
    const result = applyBreakHandling(
      [{ startedAt: madrid("13:30"), endedAt: madrid("15:30") }],
      schedule,
      "worked_extra",
    );

    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.startedAt.toISOString()).toBe(madrid("13:30").toISOString());
    expect(result.ranges[0]?.endedAt.toISOString()).toBe(madrid("15:30").toISOString());
  });

  it("cuts out break segment when user marks took_break", () => {
    const result = applyBreakHandling(
      [{ startedAt: madrid("13:30"), endedAt: madrid("15:30") }],
      schedule,
      "took_break",
    );

    expect(result.ranges).toHaveLength(2);
    expect(result.ranges[0]?.startedAt.toISOString()).toBe(madrid("13:30").toISOString());
    expect(result.ranges[0]?.endedAt.toISOString()).toBe(madrid("14:00").toISOString());
    expect(result.ranges[1]?.startedAt.toISOString()).toBe(madrid("15:00").toISOString());
    expect(result.ranges[1]?.endedAt.toISOString()).toBe(madrid("15:30").toISOString());
  });

  it("en fin de semana sin horario propio no pregunta por la comida (no hereda el viernes)", () => {
    const saturday = (time: string) => new Date(fromDatetimeLocalInputValue(`2026-07-25T${time}`));
    const fridaySchedule: BreakScheduleContext = {
      weekly: [{ dayOfWeek: 5, windows: schedule.weekly[0]!.windows }],
      overrides: [],
    };
    const result = applyBreakHandling(
      [{ startedAt: saturday("08:00"), endedAt: saturday("17:00") }],
      fridaySchedule,
    );
    expect(result.overlap.hasOverlap).toBe(false);
    expect(result.ranges).toHaveLength(1);
  });

  it("throws when overlap exists and no decision is provided", () => {
    expect(() =>
      applyBreakHandling(
        [{ startedAt: madrid("13:30"), endedAt: madrid("15:30") }],
        schedule,
      ),
    ).toThrow(/trabajo extra o descanso/i);
  });
});
