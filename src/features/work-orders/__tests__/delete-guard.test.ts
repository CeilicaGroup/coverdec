import { describe, expect, it, vi } from "vitest";
import { assertWorkOrderDeletable } from "../delete-guard";

function mockTx(overrides: {
  taskIds?: string[];
  timeEntryCount?: number;
  planningAssignmentCount?: number;
  workOrderCreatedAt?: Date | null;
}) {
  return {
    task: {
      findMany: vi.fn().mockResolvedValue(
        (overrides.taskIds ?? ["t1"]).map((id) => ({ id })),
      ),
    },
    timeEntry: {
      count: vi.fn().mockResolvedValue(overrides.timeEntryCount ?? 0),
    },
    planningAssignment: {
      count: vi.fn().mockResolvedValue(overrides.planningAssignmentCount ?? 0),
    },
    workOrder: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.workOrderCreatedAt === null
          ? null
          : { createdAt: overrides.workOrderCreatedAt ?? new Date("2000-01-01") },
      ),
    },
  };
}

describe("assertWorkOrderDeletable", () => {
  it("allows delete when there are no time entries or planning assignments", async () => {
    const tx = mockTx({});
    await expect(assertWorkOrderDeletable(tx as never, "wo-1")).resolves.toBeUndefined();
  });

  it("blocks delete when tasks have time entries", async () => {
    const tx = mockTx({ timeEntryCount: 1 });
    await expect(assertWorkOrderDeletable(tx as never, "wo-1")).rejects.toThrow(
      "registros de tiempo",
    );
  });

  it("blocks delete when tasks have planning assignments", async () => {
    const tx = mockTx({ planningAssignmentCount: 2 });
    await expect(assertWorkOrderDeletable(tx as never, "wo-1")).rejects.toThrow(
      "tareas planificadas",
    );
  });

  it("allows delete when the work order was created this week, even with planning assignments", async () => {
    const tx = mockTx({
      planningAssignmentCount: 2,
      workOrderCreatedAt: new Date(),
    });
    await expect(assertWorkOrderDeletable(tx as never, "wo-1")).resolves.toBeUndefined();
  });

  it("still blocks delete for an older work order with planning assignments", async () => {
    const tx = mockTx({
      planningAssignmentCount: 2,
      workOrderCreatedAt: new Date("2020-01-01"),
    });
    await expect(assertWorkOrderDeletable(tx as never, "wo-1")).rejects.toThrow(
      "tareas planificadas",
    );
  });
});
