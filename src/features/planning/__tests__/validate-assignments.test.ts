import { describe, expect, it } from "vitest";
import {
  assertSingleWorkerPerTask,
  findTasksWithMultipleWorkers,
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
});
