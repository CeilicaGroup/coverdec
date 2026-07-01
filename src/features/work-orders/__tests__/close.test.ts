import { describe, expect, it, vi } from "vitest";
import { WorkOrderStatus } from "@/generated/prisma";
import {
  closeWorkOrderIfAllTasksComplete,
  reopenWorkOrderIfClosed,
} from "../close";

function mockTx(overrides: {
  openCount?: number;
  status?: WorkOrderStatus;
}) {
  const update = vi.fn();
  return {
    task: {
      count: vi.fn().mockResolvedValue(overrides.openCount ?? 0),
    },
    workOrder: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.status ? { status: overrides.status } : null,
      ),
      update,
    },
    _update: update,
  };
}

describe("closeWorkOrderIfAllTasksComplete", () => {
  it("closes when no open tasks remain", async () => {
    const tx = mockTx({ openCount: 0 });
    const closed = await closeWorkOrderIfAllTasksComplete(
      tx as never,
      "wo-1",
    );
    expect(closed).toBe(true);
    expect(tx._update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wo-1" },
        data: expect.objectContaining({ status: WorkOrderStatus.CLOSED }),
      }),
    );
  });

  it("does not close when tasks remain", async () => {
    const tx = mockTx({ openCount: 1 });
    const closed = await closeWorkOrderIfAllTasksComplete(
      tx as never,
      "wo-1",
    );
    expect(closed).toBe(false);
    expect(tx._update).not.toHaveBeenCalled();
  });
});

describe("reopenWorkOrderIfClosed", () => {
  it("reopens a closed work order", async () => {
    const tx = mockTx({ status: WorkOrderStatus.CLOSED });
    const reopened = await reopenWorkOrderIfClosed(tx as never, "wo-1");
    expect(reopened).toBe(true);
    expect(tx._update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: WorkOrderStatus.OPEN, closedAt: null },
      }),
    );
  });

  it("no-ops on open work order", async () => {
    const tx = mockTx({ status: WorkOrderStatus.OPEN });
    const reopened = await reopenWorkOrderIfClosed(tx as never, "wo-1");
    expect(reopened).toBe(false);
  });
});
