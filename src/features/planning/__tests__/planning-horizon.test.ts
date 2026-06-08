import { describe, expect, it } from "vitest";
import {
  addWeeks,
  isWeekStartPastDate,
  maxWeeksForMode,
  shouldContinueHorizon,
  weekContainsDate,
  MONTH_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
} from "@/features/planning/planning-horizon";

const anchor = new Date("2026-06-01T00:00:00.000Z");

describe("planning-horizon", () => {
  it("WEEK mode stops after one week", () => {
    const result = shouldContinueHorizon({
      mode: { kind: "WEEK" },
      anchorWeekStart: anchor,
      weeksGenerated: 1,
      totalPendingBeforeHours: 40,
      totalPendingAfterHours: 20,
      projectPendingBeforeHours: 0,
      projectPendingAfterHours: 0,
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("MONTH mode allows up to 4 weeks", () => {
    expect(maxWeeksForMode({ kind: "MONTH" })).toBe(MONTH_HORIZON_WEEKS);
    const at3 = shouldContinueHorizon({
      mode: { kind: "MONTH" },
      anchorWeekStart: anchor,
      weeksGenerated: 3,
      totalPendingBeforeHours: 40,
      totalPendingAfterHours: 10,
      projectPendingBeforeHours: 0,
      projectPendingAfterHours: 0,
    });
    expect(at3.shouldContinue).toBe(true);
    const at4 = shouldContinueHorizon({
      mode: { kind: "MONTH" },
      anchorWeekStart: anchor,
      weeksGenerated: 4,
      totalPendingBeforeHours: 10,
      totalPendingAfterHours: 5,
      projectPendingBeforeHours: 0,
      projectPendingAfterHours: 0,
    });
    expect(at4.shouldContinue).toBe(false);
    expect(at4.stallReason).toBe("max_weeks");
  });

  it("ALL_PROJECTS stops when pending is done", () => {
    const result = shouldContinueHorizon({
      mode: { kind: "ALL_PROJECTS" },
      anchorWeekStart: anchor,
      weeksGenerated: 2,
      totalPendingBeforeHours: 5,
      totalPendingAfterHours: 0,
      projectPendingBeforeHours: 0,
      projectPendingAfterHours: 0,
    });
    expect(result.shouldContinue).toBe(false);
    expect(result.stallReason).toBe("pending_done");
  });

  it("PROJECT mode uses project pending for stop", () => {
    const result = shouldContinueHorizon({
      mode: { kind: "PROJECT", projectId: "p1" },
      anchorWeekStart: anchor,
      weeksGenerated: 2,
      totalPendingBeforeHours: 100,
      totalPendingAfterHours: 80,
      projectPendingBeforeHours: 2,
      projectPendingAfterHours: 0,
    });
    expect(result.shouldContinue).toBe(false);
    expect(result.stallReason).toBe("pending_done");
  });

  it("detects stall when pending does not decrease", () => {
    const result = shouldContinueHorizon({
      mode: { kind: "ALL_PROJECTS" },
      anchorWeekStart: anchor,
      weeksGenerated: 2,
      totalPendingBeforeHours: 50,
      totalPendingAfterHours: 50,
      projectPendingBeforeHours: 0,
      projectPendingAfterHours: 0,
    });
    expect(result.shouldContinue).toBe(false);
    expect(result.stallReason).toBe("no_progress");
  });

  it("UNTIL_DATE stops when next week is past target", () => {
    const result = shouldContinueHorizon({
      mode: { kind: "UNTIL_DATE", untilIso: "2026-06-12" },
      anchorWeekStart: anchor,
      weeksGenerated: 2,
      totalPendingBeforeHours: 50,
      totalPendingAfterHours: 40,
      projectPendingBeforeHours: 0,
      projectPendingAfterHours: 0,
    });
    expect(result.shouldContinue).toBe(false);
    expect(result.stallReason).toBe("date_reached");
  });

  it("ALL_PROJECTS respects max weeks cap", () => {
    expect(maxWeeksForMode({ kind: "ALL_PROJECTS" })).toBe(MAX_HORIZON_WEEKS);
  });

  it("addWeeks advances by 7 days", () => {
    const next = addWeeks(anchor, 1);
    expect(next.toISOString().slice(0, 10)).toBe("2026-06-08");
  });

  it("weekContainsDate matches business week", () => {
    expect(weekContainsDate(anchor, "2026-06-03")).toBe(true);
    expect(weekContainsDate(anchor, "2026-06-08")).toBe(false);
  });

  it("isWeekStartPastDate compares mondays", () => {
    expect(isWeekStartPastDate(new Date("2026-06-15T00:00:00.000Z"), "2026-06-10")).toBe(
      true,
    );
    expect(isWeekStartPastDate(anchor, "2026-06-30")).toBe(false);
  });
});
