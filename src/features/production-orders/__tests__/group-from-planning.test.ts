import { describe, expect, it } from "vitest";
import { groupAssignmentsIntoBatches } from "@/features/production-orders/group-from-planning";

describe("groupAssignmentsIntoBatches", () => {
  it("groups same process, nave and element type into one batch", () => {
    const batches = groupAssignmentsIntoBatches([
      {
        hours: 4,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "CNC",
        task: {
          id: "t1",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p1",
          project: { name: "Proyecto A" },
          lampElement: { elementTypeId: "et-mdf", units: 1 },
        },
        planning: {
          naveId: "n1",
          weekStart: new Date("2026-05-04T00:00:00.000Z"),
          planningGroupId: "grp-1",
        },
      },
      {
        hours: 3,
        date: new Date("2026-05-06T00:00:00.000Z"),
        process: "CNC",
        task: {
          id: "t2",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p2",
          project: { name: "Proyecto B" },
          lampElement: { elementTypeId: "et-mdf", units: 2 },
        },
        planning: {
          naveId: "n1",
          weekStart: new Date("2026-05-04T00:00:00.000Z"),
          planningGroupId: "grp-1",
        },
      },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.hours).toBe(7);
    expect(batches[0]!.lines).toHaveLength(2);
    expect(batches[0]!.scheduledAt).toBe("2026-05-05");
  });

  it("splits tasks with separateWorkOrder into individual batches", () => {
    const batches = groupAssignmentsIntoBatches([
      {
        hours: 2,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "CNC",
        task: {
          id: "t1",
          naveId: "n1",
          separateWorkOrder: true,
          projectId: "p1",
          project: { name: "Proyecto A" },
          lampElement: { elementTypeId: "et-mdf", units: 1 },
        },
        planning: {
          naveId: "n1",
          weekStart: new Date("2026-05-04T00:00:00.000Z"),
          planningGroupId: "grp-1",
        },
      },
      {
        hours: 3,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "CNC",
        task: {
          id: "t2",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p2",
          project: { name: "Proyecto B" },
          lampElement: { elementTypeId: "et-mdf", units: 1 },
        },
        planning: {
          naveId: "n1",
          weekStart: new Date("2026-05-04T00:00:00.000Z"),
          planningGroupId: "grp-1",
        },
      },
    ]);

    expect(batches).toHaveLength(2);
    const separate = batches.find((b) => b.lines[0]?.taskId === "t1");
    expect(separate?.batchKey).toContain("task:t1");
    expect(separate?.lines).toHaveLength(1);
  });
});
