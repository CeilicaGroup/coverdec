import { describe, expect, it, vi } from "vitest";
import { assertWorkOrderDeletable } from "../delete-guard";

function mockTx(overrides: {
  taskIds?: string[];
  timeEntryCount?: number;
  planningAssignmentCount?: number;
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
});
