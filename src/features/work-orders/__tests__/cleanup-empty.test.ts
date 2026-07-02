import { describe, expect, it, vi } from "vitest";
import { WorkOrderStatus } from "@/generated/prisma";
import { deleteEmptyOpenWorkOrders } from "../cleanup-empty";

function mockTx(overrides: {
  workOrders?: Array<{ id: string; status: WorkOrderStatus }>;
  taskCountByWorkOrderId?: Record<string, number>;
}) {
  const workOrders = new Map(
    (overrides.workOrders ?? []).map((wo) => [wo.id, wo]),
  );
  const taskCountByWorkOrderId = overrides.taskCountByWorkOrderId ?? {};

  return {
    workOrder: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        workOrders.get(where.id) ?? null,
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        workOrders.delete(where.id);
      }),
    },
    task: {
      count: vi.fn(
        async ({ where }: { where: { workOrderId: string } }) =>
          taskCountByWorkOrderId[where.workOrderId] ?? 0,
      ),
    },
  };
}

describe("deleteEmptyOpenWorkOrders", () => {
  it("deletes open work orders with zero tasks", async () => {
    const tx = mockTx({
      workOrders: [{ id: "wo-1", status: WorkOrderStatus.OPEN }],
      taskCountByWorkOrderId: { "wo-1": 0 },
    });

    const deleted = await deleteEmptyOpenWorkOrders(tx as never, ["wo-1"]);

    expect(deleted).toBe(1);
    expect(tx.workOrder.delete).toHaveBeenCalledWith({ where: { id: "wo-1" } });
  });

  it("keeps open work orders that still have tasks", async () => {
    const tx = mockTx({
      workOrders: [{ id: "wo-1", status: WorkOrderStatus.OPEN }],
      taskCountByWorkOrderId: { "wo-1": 2 },
    });

    const deleted = await deleteEmptyOpenWorkOrders(tx as never, ["wo-1"]);

    expect(deleted).toBe(0);
    expect(tx.workOrder.delete).not.toHaveBeenCalled();
  });

  it("does not delete closed work orders even when empty", async () => {
    const tx = mockTx({
      workOrders: [{ id: "wo-1", status: WorkOrderStatus.CLOSED }],
      taskCountByWorkOrderId: { "wo-1": 0 },
    });

    const deleted = await deleteEmptyOpenWorkOrders(tx as never, ["wo-1"]);

    expect(deleted).toBe(0);
    expect(tx.workOrder.delete).not.toHaveBeenCalled();
  });
});
