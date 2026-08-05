import { describe, expect, it } from "vitest";
import {
  applyAttendanceBreakHandling,
  summarizeAttendanceBreakOverlap,
} from "../apply-attendance-break-handling";
import type { BreakScheduleContext } from "@/features/time-tracking/break-handling";

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

const dayIso = "2026-07-20"; // Monday

function wall(time: string): Date {
  return new Date(`${dayIso}T${time}:00.000Z`);
}

describe("attendance break handling", () => {
  it("detects full-day range that spans lunch", () => {
    const summary = summarizeAttendanceBreakOverlap(
      { startedAt: wall("08:00"), endedAt: wall("17:00") },
      dayIso,
      schedule,
    );
    expect(summary.hasOverlap).toBe(true);
    expect(summary.overlapMinutes).toBe(60);
  });

  it("does not flag morning-only range", () => {
    const summary = summarizeAttendanceBreakOverlap(
      { startedAt: wall("08:00"), endedAt: wall("14:00") },
      dayIso,
      schedule,
    );
    expect(summary.hasOverlap).toBe(false);
  });

  it("requires breakHandling when there is overlap", () => {
    expect(() =>
      applyAttendanceBreakHandling({
        startedAt: wall("08:00"),
        endedAt: wall("17:00"),
        dayIso,
        schedule,
      }),
    ).toThrow(/Indica si fue trabajo extra o descanso/);
  });

  it("keeps gross minutes when worked_extra", () => {
    const result = applyAttendanceBreakHandling({
      startedAt: wall("08:00"),
      endedAt: wall("17:00"),
      dayIso,
      schedule,
      breakHandling: "worked_extra",
    });
    expect(result.breaks).toHaveLength(0);
    expect(result.minutes).toBe(9 * 60);
    expect(result.appliedBreakHandling).toBe("worked_extra");
  });

  it("creates lunch break and net minutes when took_break", () => {
    const result = applyAttendanceBreakHandling({
      startedAt: wall("08:00"),
      endedAt: wall("17:00"),
      dayIso,
      schedule,
      breakHandling: "took_break",
    });
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0]?.startedAt.toISOString()).toBe(wall("14:00").toISOString());
    expect(result.breaks[0]?.endedAt.toISOString()).toBe(wall("15:00").toISOString());
    expect(result.minutes).toBe(8 * 60);
    expect(result.appliedBreakHandling).toBe("took_break");
  });

  it("does not require handling without overlap", () => {
    const result = applyAttendanceBreakHandling({
      startedAt: wall("08:00"),
      endedAt: wall("14:00"),
      dayIso,
      schedule,
    });
    expect(result.breaks).toHaveLength(0);
    expect(result.minutes).toBe(6 * 60);
    expect(result.appliedBreakHandling).toBeUndefined();
  });

  it("rejects range that is only the break", () => {
    expect(() =>
      applyAttendanceBreakHandling({
        startedAt: wall("14:00"),
        endedAt: wall("15:00"),
        dayIso,
        schedule,
        breakHandling: "took_break",
      }),
    ).toThrow(/solo a descanso/);
  });
});
