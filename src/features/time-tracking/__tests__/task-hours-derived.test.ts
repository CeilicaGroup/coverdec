import { describe, expect, it } from "vitest";
import { resolveTaskDoneHours } from "@/features/time-tracking/task-hours-derived";

describe("resolveTaskDoneHours", () => {
  it("uses estimated hours when task is completed without time entries", () => {
    expect(
      resolveTaskDoneHours({
        estimatedHours: 12,
        doneHours: 0,
        isCompleted: true,
      }),
    ).toBe(12);
  });

  it("uses logged hours when task is not completed", () => {
    expect(
      resolveTaskDoneHours({
        estimatedHours: 12,
        doneHours: 5,
        isCompleted: false,
      }),
    ).toBe(5);
  });
});
