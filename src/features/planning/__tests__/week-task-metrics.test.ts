import { describe, expect, it } from "vitest";
import { computeWeekTaskMetrics } from "@/features/planning/week-progress";

describe("computeWeekTaskMetrics", () => {
  it("week scope is pending plus assigned this week", () => {
    const m = computeWeekTaskMetrics({
      estimatedHours: 8,
      doneHours: 0,
      priorPlannedHours: 5,
      assignedThisWeekHours: 2,
      pendingHours: 1,
    });
    expect(m.weekScopeHours).toBe(3);
    expect(m.pendingHours).toBe(1);
  });
});
