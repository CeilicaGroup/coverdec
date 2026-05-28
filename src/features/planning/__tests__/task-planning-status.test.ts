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
        pendingHours: 5,
        doneHours: 2,
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
        pendingHours: 5,
        doneHours: 2,
        estimatedHours: 8,
      }),
    ).toBe(0);
  });

  it("returns 0 for a completed task (pendingHours=0)", () => {
    expect(
      effectivePendingHours({ pendingHours: 0, doneHours: 8, estimatedHours: 8 }),
    ).toBe(0);
  });

  it("returns 0 for a task where doneHours >= estimatedHours", () => {
    expect(
      effectivePendingHours({ pendingHours: 2, doneHours: 8, estimatedHours: 8 }),
    ).toBe(0);
  });

  it("returns pendingHours when it is smaller than remaining", () => {
    expect(
      effectivePendingHours({ pendingHours: 3, doneHours: 0, estimatedHours: 8 }),
    ).toBe(3);
  });

  it("returns only unplanned remainder when partially planned in prior weeks", () => {
    expect(
      effectivePendingHours(
        { pendingHours: 8, doneHours: 0, estimatedHours: 8 },
        { priorPlannedHours: 5 },
      ),
    ).toBe(3);
  });
});
