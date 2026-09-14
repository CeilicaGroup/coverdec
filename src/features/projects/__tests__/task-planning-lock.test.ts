import { describe, expect, it } from "vitest";
import {
  assertTasksNotPlannedFromRows,
  taskBlocksDeletion,
  taskHasPlanningAssignments,
  TASK_PLANNED_ERROR,
} from "@/features/projects/task-planning-lock";

describe("task-planning-lock", () => {
  it("detects tasks with planning assignments", () => {
    expect(taskHasPlanningAssignments({ _count: { assignments: 0 } })).toBe(false);
    expect(taskHasPlanningAssignments({ _count: { assignments: 2 } })).toBe(true);
    expect(taskHasPlanningAssignments({})).toBe(false);
  });

  it("throws when any task is planned", () => {
    expect(() =>
      assertTasksNotPlannedFromRows([
        { _count: { assignments: 0 } },
        { _count: { assignments: 1 } },
      ]),
    ).toThrow(TASK_PLANNED_ERROR);
  });

  it("allows unplanned tasks", () => {
    expect(() =>
      assertTasksNotPlannedFromRows([{ _count: { assignments: 0 } }]),
    ).not.toThrow();
  });
});

describe("taskBlocksDeletion", () => {
  const now = new Date("2026-05-13T10:00:00Z"); // Wednesday

  it("blocks a planned task created before this week", () => {
    expect(
      taskBlocksDeletion(
        { createdAt: new Date("2026-05-04T00:00:00Z"), _count: { assignments: 1 } },
        now,
      ),
    ).toBe(true);
  });

  it("allows a planned task created this week", () => {
    expect(
      taskBlocksDeletion(
        { createdAt: new Date("2026-05-11T00:00:00Z"), _count: { assignments: 1 } },
        now,
      ),
    ).toBe(false);
  });

  it("allows an unplanned task regardless of when it was created", () => {
    expect(
      taskBlocksDeletion(
        { createdAt: new Date("2026-01-01T00:00:00Z"), _count: { assignments: 0 } },
        now,
      ),
    ).toBe(false);
  });
});
