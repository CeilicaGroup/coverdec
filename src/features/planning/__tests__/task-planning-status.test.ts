import { describe, expect, it } from "vitest";
import {
  effectivePendingHours,
  isTaskClosedForPlanning,
} from "../task-planning-status";

describe("isTaskClosedForPlanning", () => {
  it("treats isCompleted as closed even with pending hours", () => {
    expect(
      isTaskClosedForPlanning({
        isCompleted: true,
        pendingToPlanHours: 5,
        remainingWorkHours: 6,
        estimatedHours: 8,
      }),
    ).toBe(true);
  });
});

describe("effectivePendingHours", () => {
  it("returns 0 when isCompleted", () => {
    expect(
      effectivePendingHours({
        isCompleted: true,
        pendingToPlanHours: 5,
        remainingWorkHours: 6,
        estimatedHours: 8,
      }),
    ).toBe(0);
  });

  it("returns 0 for a completed task (pendingHours=0)", () => {
    expect(
      effectivePendingHours({ pendingToPlanHours: 0, remainingWorkHours: 0, estimatedHours: 8 }),
    ).toBe(0);
  });

  it("returns 0 for a task where doneHours >= estimatedHours", () => {
    expect(
      effectivePendingHours({ pendingToPlanHours: 2, remainingWorkHours: 0, estimatedHours: 8 }),
    ).toBe(0);
  });

  it("returns pendingHours when it is smaller than remaining", () => {
    expect(
      effectivePendingHours({ pendingToPlanHours: 3, remainingWorkHours: 8, estimatedHours: 8 }),
    ).toBe(3);
  });

  it("returns only unplanned remainder when partially planned in prior weeks", () => {
    expect(
      effectivePendingHours(
        { pendingToPlanHours: 8, remainingWorkHours: 8, estimatedHours: 8 },
        { priorPlannedHours: 5 },
      ),
    ).toBe(3);
  });
});
