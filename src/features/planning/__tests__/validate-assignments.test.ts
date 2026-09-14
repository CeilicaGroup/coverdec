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
    ).toThrow(/más operarios de los permitidos/);
  });

  it("allows a task to have up to its configured worker limit", () => {
    expect(() =>
      assertSingleWorkerPerTask(
        [
          { taskId: "t1", personId: "p1" },
          { taskId: "t1", personId: "p2" },
        ],
        { limitByTaskId: new Map([["t1", 2]]) },
      ),
    ).not.toThrow();
  });

  it("still throws when a task exceeds its configured worker limit", () => {
    expect(() =>
      assertSingleWorkerPerTask(
        [
          { taskId: "t1", personId: "p1" },
          { taskId: "t1", personId: "p2" },
          { taskId: "t1", personId: "p3" },
        ],
        { limitByTaskId: new Map([["t1", 2]]) },
      ),
    ).toThrow(/más operarios de los permitidos/);
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

  it("allows a work order to have up to its configured worker limit", () => {
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
        { limitByWorkOrderId: new Map([["wo-1", 2]]) },
      ),
    ).not.toThrow();
  });

  it("still throws when disjoint per-task worker sets exceed the work order limit", () => {
    // t1 -> {p1, p2}, t2 -> {p2, p3}: union is 3 distinct people, above the limit
    // of 2, even though neither task individually exceeds it.
    expect(() =>
      assertSingleWorkerPerWorkOrder(
        [
          { taskId: "t1", personId: "p1" },
          { taskId: "t1", personId: "p2" },
          { taskId: "t2", personId: "p2" },
          { taskId: "t2", personId: "p3" },
        ],
        new Map([
          ["t1", "wo-1"],
          ["t2", "wo-1"],
        ]),
        new Map([["wo-1", "OT0001-2026"]]),
        { limitByWorkOrderId: new Map([["wo-1", 2]]) },
      ),
    ).toThrow(/misma OT/);
  });
});
