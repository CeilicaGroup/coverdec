import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitWorkOrderInTx } from "../split-work-order";
import { allocateWorkOrderNumber } from "../number";
import { assignTasksToWorkOrder } from "../validate-tasks";

vi.mock("../number", () => ({
  allocateWorkOrderNumber: vi.fn(),
}));

vi.mock("../validate-tasks", () => ({
  assignTasksToWorkOrder: vi.fn(),
}));

describe("splitWorkOrderInTx", () => {
  const findUnique = vi.fn();
  const create = vi.fn();
  const tx = {
    workOrder: {
      findUnique,
      create,
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      id: "wo-source",
      number: "OT0001-2026",
      status: "OPEN",
      tasks: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
    });
    create.mockResolvedValue({ id: "wo-new", number: "OT0002-2026" });
    vi.mocked(allocateWorkOrderNumber).mockResolvedValue({
      year: 2026,
      serial: 2,
      number: "OT0002-2026",
    });
    vi.mocked(assignTasksToWorkOrder).mockResolvedValue(undefined);
  });

  it("creates a new work order and reassigns selected tasks", async () => {
    const result = await splitWorkOrderInTx(tx, {
      workOrderId: "wo-source",
      taskIds: ["t1", "t3"],
      notes: "División manual",
    });

    expect(result).toEqual({ id: "wo-new", number: "OT0002-2026" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: "OT0002-2026",
          notes: "División manual",
        }),
      }),
    );
    expect(assignTasksToWorkOrder).toHaveBeenNthCalledWith(
      1,
      tx,
      "wo-source",
      ["t2"],
    );
    expect(assignTasksToWorkOrder).toHaveBeenNthCalledWith(
      2,
      tx,
      "wo-new",
      ["t1", "t3"],
    );
  });

  it("fails when all tasks are selected", async () => {
    await expect(
      splitWorkOrderInTx(tx, {
        workOrderId: "wo-source",
        taskIds: ["t1", "t2", "t3"],
      }),
    ).rejects.toThrow(/conservar al menos una tarea/);
  });

  it("fails when source is closed", async () => {
    findUnique.mockResolvedValueOnce({
      id: "wo-source",
      number: "OT0001-2026",
      status: "CLOSED",
      tasks: [{ id: "t1" }, { id: "t2" }],
    });

    await expect(
      splitWorkOrderInTx(tx, {
        workOrderId: "wo-source",
        taskIds: ["t1"],
      }),
    ).rejects.toThrow(/dividir OT abiertas/);
  });
});
