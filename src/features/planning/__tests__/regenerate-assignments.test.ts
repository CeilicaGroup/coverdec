import { describe, expect, it } from "vitest";
import {
  buildFixedAssignmentsForRegenerate,
  partitionAssignmentsByPlanFrom,
} from "../load-engine-input";

const weekStart = new Date("2026-05-04T00:00:00.000Z");

const taskById = new Map([
  [
    "open-1",
    {
      pendingToPlanHours: 4,
      remainingWorkHours: 8,
      estimatedHours: 8,
      isCompleted: false,
    },
  ],
  [
    "done-1",
    {
      pendingToPlanHours: 0,
      remainingWorkHours: 0,
      estimatedHours: 8,
      isCompleted: true,
    },
  ],
]);

describe("partitionAssignmentsByPlanFrom", () => {
  it("splits assignments before and from anchor day", () => {
    const assignments = [
      {
        taskId: "open-1",
        personId: "p1",
        date: new Date("2026-05-04T00:00:00.000Z"),
        startSlot: 0,
        endSlot: 2,
        hours: 2,
        process: "CNC",
      },
      {
        taskId: "open-1",
        personId: "p1",
        date: new Date("2026-05-06T00:00:00.000Z"),
        startSlot: 0,
        endSlot: 2,
        hours: 2,
        process: "CNC",
      },
    ];
    const { beforeAnchor, fromAnchor } = partitionAssignmentsByPlanFrom(
      assignments,
      weekStart,
      2,
    );
    expect(beforeAnchor).toHaveLength(1);
    expect(fromAnchor).toHaveLength(1);
  });
});

describe("buildFixedAssignmentsForRegenerate", () => {
  it("fixes completed tasks and days before anchor", () => {
    const assignments = [
      {
        taskId: "open-1",
        personId: "p1",
        date: new Date("2026-05-04T00:00:00.000Z"),
        startSlot: 0,
        endSlot: 2,
        hours: 2,
        process: "CNC",
      },
      {
        taskId: "open-1",
        personId: "p1",
        date: new Date("2026-05-06T00:00:00.000Z"),
        startSlot: 4,
        endSlot: 6,
        hours: 2,
        process: "CNC",
      },
      {
        taskId: "done-1",
        personId: "p1",
        date: new Date("2026-05-06T00:00:00.000Z"),
        startSlot: 8,
        endSlot: 10,
        hours: 2,
        process: "CNC",
      },
    ];
    const fixed = buildFixedAssignmentsForRegenerate(
      assignments,
      taskById,
      weekStart,
      2,
    );
    expect(fixed).toHaveLength(2);
    expect(fixed.map((f) => f.taskId).sort()).toEqual(["done-1", "open-1"]);
    expect(
      fixed.find((f) => f.taskId === "open-1")?.date.toISOString(),
    ).toBe("2026-05-04T00:00:00.000Z");
  });
});
