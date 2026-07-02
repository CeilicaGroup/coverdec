import { describe, expect, it } from "vitest";
import {
  assertTasksNotPlannedFromRows,
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
