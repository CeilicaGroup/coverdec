import { describe, expect, it } from "vitest";
import {
  assertSingleWorkerPerTask,
  assertSingleWorkerPerWorkOrder,
  findTasksWithMultipleWorkers,
  findWorkOrdersWithMultipleWorkers,
} from "../validate-assignments";

describe("validate-assignments", () => {
  it("detects tasks assigned to multiple workers", () => {
    const conflicts = findTasksWithMultipleWorkers([
      { taskId: "t1", personId: "p1" },
      { taskId: "t1", personId: "p2" },
      { taskId: "t2", personId: "p1" },
    ]);
    expect(conflicts).toEqual([{ taskId: "t1", personIds: ["p1", "p2"] }]);
  });

  it("passes when each task has a single worker", () => {
    expect(() =>
      assertSingleWorkerPerTask([
        { taskId: "t1", personId: "p1" },
        { taskId: "t1", personId: "p1" },
        { taskId: "t2", personId: "p2" },
      ]),
    ).not.toThrow();
  });

  it("throws with task ids when multiple workers share a task", () => {
    expect(() =>
      assertSingleWorkerPerTask([
        { taskId: "t1", personId: "p1" },
        { taskId: "t1", personId: "p2" },
      ]),
    ).toThrow(/más de un operario/);
  });

  it("detects multiple workers on tasks from the same work order", () => {
    const conflicts = findWorkOrdersWithMultipleWorkers(
      [
        { taskId: "t1", personId: "p1" },
        { taskId: "t2", personId: "p2" },
      ],
      new Map([
        ["t1", "wo-1"],
        ["t2", "wo-1"],
      ]),
      new Map([["wo-1", "OT0001-2026"]]),
    );
    expect(conflicts).toEqual([
      {
        workOrderId: "wo-1",
        workOrderNumber: "OT0001-2026",
        personIds: ["p1", "p2"],
        taskIds: ["t1", "t2"],
      },
    ]);
  });

  it("throws when a work order spans multiple workers", () => {
    expect(() =>
      assertSingleWorkerPerWorkOrder(
        [
          { taskId: "t1", personId: "p1" },
          { taskId: "t2", personId: "p2" },
        ],
        new Map([
          ["t1", "wo-1"],
          ["t2", "wo-1"],
        ]),
        new Map([["wo-1", "OT0001-2026"]]),
      ),
    ).toThrow(/misma OT/);
  });
});
