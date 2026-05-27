import { describe, expect, it } from "vitest";
import {
  buildGanttTimeAxisContext,
  computeGlobalWorkerScheduleBounds,
} from "@/features/planning/gantt-time-axis";

describe("gantt-time-axis", () => {
  it("uses min start and max end across worker windows", () => {
    const bounds = computeGlobalWorkerScheduleBounds([
      { dayOfWeek: 1, startMinutes: 6 * 60 + 30, endMinutes: 14 * 60 },
      { dayOfWeek: 2, startMinutes: 8 * 60, endMinutes: 19 * 60 },
    ]);
    expect(bounds.dayStartMinutes).toBe(6 * 60 + 30);
    expect(bounds.dayEndMinutes).toBe(19 * 60);
  });

  it("returns per-weekday bounds when available", () => {
    const ctx = buildGanttTimeAxisContext([
      { dayOfWeek: 2, startMinutes: 9 * 60, endMinutes: 16 * 60 },
    ]);
    const tuesday = ctx.boundsForDayIso("2026-05-12");
    expect(tuesday.dayStartMinutes).toBe(9 * 60);
    expect(tuesday.dayEndMinutes).toBe(16 * 60);
  });
});
