import { describe, expect, it } from "vitest";
import {
  filterOverrideAssignments,
  mergeOverrideAssignmentsAfterSolver,
} from "../planning-override-preserve";

describe("planning-override-preserve", () => {
  it("filters only override assignments", () => {
    const filtered = filterOverrideAssignments([
      { taskId: "t1", isOverride: true },
      { taskId: "t2", isOverride: false },
      { taskId: "t3", isOverride: true },
    ]);
    expect(filtered.map((row) => row.taskId)).toEqual(["t1", "t3"]);
  });

  it("merges overrides without duplicating solver task ids", () => {
    const merged = mergeOverrideAssignmentsAfterSolver(
      [
        {
          taskId: "adhoc-1",
          personId: "p1",
          date: new Date("2026-07-02T00:00:00.000Z"),
          startSlot: 2,
          endSlot: 3,
          hours: 1,
          process: "IMPREVISTA",
          isAfternoon: false,
        },
      ],
      [
        {
          taskId: "t1",
          personId: "p1",
          date: new Date("2026-07-02T00:00:00.000Z"),
          startSlot: 0,
          endSlot: 2,
          hours: 2,
          process: "CNC",
          isAfternoon: false,
        },
        {
          taskId: "adhoc-1",
          personId: "p2",
          date: new Date("2026-07-02T00:00:00.000Z"),
          startSlot: 4,
          endSlot: 5,
          hours: 1,
          process: "IMPREVISTA",
          isAfternoon: false,
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.taskId === "t1")?.personId).toBe("p1");
    expect(merged.find((row) => row.taskId === "adhoc-1")?.personId).toBe("p1");
    expect(merged.find((row) => row.taskId === "adhoc-1")?.startSlot).toBe(2);
  });
});
