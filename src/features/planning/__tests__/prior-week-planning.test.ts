import { describe, expect, it } from "vitest";
import {
  buildLastAssignmentEndByTaskId,
  computeMinWeekQuarterByTaskId,
  dateTimeToWeekQuarter,
} from "@/features/planning/prior-week-planning";

const WEEK_START = new Date("2026-05-04T00:00:00.000Z");

describe("prior-week-planning", () => {
  it("picks the latest assignment end per task", () => {
    const ends = buildLastAssignmentEndByTaskId([
      {
        taskId: "a",
        date: new Date("2026-04-28T00:00:00.000Z"),
        endSlot: 4,
        hours: 4,
      },
      {
        taskId: "a",
        date: new Date("2026-04-30T00:00:00.000Z"),
        endSlot: 6,
        hours: 2,
      },
    ]);
    expect(ends.get("a")).toEqual({
      date: new Date("2026-04-30T00:00:00.000Z"),
      endSlot: 6,
    });
  });

  it("blocks successor until after prior-week predecessor + dry time", () => {
    const tasks = [
      {
        id: "pred",
        lampId: "l1",
        order: 0,
        process: "PINTURA",
        pendingToPlanHours: 0,
        remainingWorkHours: 0,
        estimatedHours: 8,
      },
      {
        id: "succ",
        lampId: "l1",
        order: 1,
        process: "MONTAJE",
        pendingToPlanHours: 8,
        remainingWorkHours: 8,
        estimatedHours: 8,
      },
    ];
    const priorEnds = buildLastAssignmentEndByTaskId([
      {
        taskId: "pred",
        date: new Date("2026-04-30T00:00:00.000Z"),
        endSlot: 6,
        hours: 8,
      },
    ]);
    const { minByTask } = computeMinWeekQuarterByTaskId({
      weekStart: WEEK_START,
      tasks,
      engineTaskIds: new Set(["succ"]),
      priorEnds,
      waitHoursByProcess: new Map([["PINTURA", 72]]),
      holidayDates: new Set(),
    });
    const minQ = minByTask.get("succ") ?? 0;
    expect(minQ).toBeGreaterThan(0);
    expect(dateTimeToWeekQuarter(WEEK_START, WEEK_START)).toBe(0);
  });

  it("does not block successor in another element on same lamp", () => {
    const tasks = [
      {
        id: "elem1-pred",
        lampId: "l1",
        lampElementId: "elem-1",
        order: 0,
        process: "PINTURA",
        pendingToPlanHours: 0,
        remainingWorkHours: 0,
        estimatedHours: 8,
      },
      {
        id: "elem2-succ",
        lampId: "l1",
        lampElementId: "elem-2",
        order: 1000,
        process: "CNC",
        pendingToPlanHours: 4,
        remainingWorkHours: 4,
        estimatedHours: 4,
      },
    ];
    const priorEnds = buildLastAssignmentEndByTaskId([
      {
        taskId: "elem1-pred",
        date: new Date("2026-04-30T00:00:00.000Z"),
        endSlot: 6,
        hours: 8,
      },
    ]);
    const { minByTask } = computeMinWeekQuarterByTaskId({
      weekStart: WEEK_START,
      tasks,
      engineTaskIds: new Set(["elem2-succ"]),
      priorEnds,
      waitHoursByProcess: new Map([["PINTURA", 72]]),
      holidayDates: new Set(),
    });
    expect(minByTask.has("elem2-succ")).toBe(false);
  });
});
