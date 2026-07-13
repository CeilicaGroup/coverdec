import { describe, expect, it } from "vitest";
import { computeWorkOrderPipelines } from "../work-order-pipeline";

describe("computeWorkOrderPipelines", () => {
  const waitHours = new Map([["PROC_A", 0], ["PROC_B", 0], ["PROC_C", 2]]);

  it("computes 1h offset when first B depends on first A", () => {
    const edges = computeWorkOrderPipelines(
      [
        {
          id: "a1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 0,
          process: "PROC_A",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-a",
          workOrderSequence: 0,
        },
        {
          id: "a2",
          lampId: "l2",
          lampElementId: "el-2",
          order: 0,
          process: "PROC_A",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-a",
          workOrderSequence: 1,
        },
        {
          id: "b1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 10,
          process: "PROC_B",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-b",
          workOrderSequence: 0,
        },
        {
          id: "b2",
          lampId: "l2",
          lampElementId: "el-2",
          order: 10,
          process: "PROC_B",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-b",
          workOrderSequence: 1,
        },
      ],
      waitHours,
    );

    expect(edges).toEqual([
      {
        predecessorWorkOrderId: "wo-a",
        successorWorkOrderId: "wo-b",
        minCompletedHours: 1,
      },
    ]);
  });

  it("sums hours through predecessor index when chain is deeper", () => {
    const edges = computeWorkOrderPipelines(
      [
        {
          id: "a1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 0,
          process: "PROC_A",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-a",
          workOrderSequence: 0,
        },
        {
          id: "c1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 5,
          process: "PROC_C",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-a",
          workOrderSequence: 1,
        },
        {
          id: "b1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 10,
          process: "PROC_B",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-b",
          workOrderSequence: 0,
        },
      ],
      waitHours,
    );

    expect(edges).toEqual([
      {
        predecessorWorkOrderId: "wo-a",
        successorWorkOrderId: "wo-b",
        minCompletedHours: 4,
      },
    ]);
  });

  it("skips edge when predecessor is already complete", () => {
    const edges = computeWorkOrderPipelines(
      [
        {
          id: "a1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 0,
          process: "PROC_A",
          pendingHours: 0,
          isCompleted: true,
          workOrderId: "wo-a",
          workOrderSequence: 0,
        },
        {
          id: "b1",
          lampId: "l1",
          lampElementId: "el-1",
          order: 10,
          process: "PROC_B",
          pendingHours: 1,
          isCompleted: false,
          workOrderId: "wo-b",
          workOrderSequence: 0,
        },
      ],
      waitHours,
    );

    expect(edges).toEqual([]);
  });
});
