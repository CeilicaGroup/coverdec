import { describe, expect, it } from "vitest";
import {
  computeWeekProgress,
  taskHasRemainingToPlan,
} from "@/features/planning/week-progress";

describe("computeWeekProgress", () => {
  it("combines done and prior planned as base, adds this week for end", () => {
    const p = computeWeekProgress({
      estimatedHours: 100,
      doneHours: 10,
      priorPlannedHours: 23,
      assignedThisWeekHours: 11,
    });
    expect(p.donePct).toBe(10);
    expect(p.priorPlannedPct).toBe(23);
    expect(p.weekPlannedPct).toBe(11);
    expect(p.progressBasePct).toBe(33);
    expect(p.progressEndPct).toBe(44);
  });

  it("stacks segments without double-counting done and prior", () => {
    const p = computeWeekProgress({
      estimatedHours: 100,
      doneHours: 60,
      priorPlannedHours: 0,
      assignedThisWeekHours: 40,
    });
    expect(p.donePct).toBe(60);
    expect(p.priorPlannedPct).toBe(0);
    expect(p.weekPlannedPct).toBe(40);
    expect(p.progressBasePct).toBe(60);
    expect(p.progressEndPct).toBe(100);
  });

  it("caps at 100%", () => {
    const p = computeWeekProgress({
      estimatedHours: 8,
      doneHours: 0,
      priorPlannedHours: 8,
      assignedThisWeekHours: 4,
    });
    expect(p.progressBasePct).toBe(100);
    expect(p.progressEndPct).toBe(100);
    expect(p.weekPlannedPct).toBe(0);
  });
});

describe("taskHasRemainingToPlan", () => {
  it("is false when marked completed", () => {
    expect(
      taskHasRemainingToPlan({
        estimatedHours: 8,
        doneHours: 2,
        pendingHours: 5,
        isCompleted: true,
      }),
    ).toBe(false);
  });

  it("is false when pending is zero", () => {
    expect(
      taskHasRemainingToPlan({
        estimatedHours: 8,
        doneHours: 0,
        pendingHours: 0,
      }),
    ).toBe(false);
  });

  it("is true when pending remains", () => {
    expect(
      taskHasRemainingToPlan({
        estimatedHours: 8,
        doneHours: 0,
        pendingHours: 3,
      }),
    ).toBe(true);
  });
});
