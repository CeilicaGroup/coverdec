import { describe, expect, it, vi } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import { createAdHocTaskRecord } from "@/features/ad-hoc/create-ad-hoc-task";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";

function createMockTx() {
  const tx = {
    project: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({ id: "project-pool", kind: "IMPREVISTAS" })),
    },
    lamp: {
      upsert: vi.fn(async () => ({ id: "lamp-pool", projectId: "project-pool" })),
    },
    task: {
      aggregate: vi.fn(async () => ({ _max: { order: 2 } })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "task-1",
        ...args.data,
      })),
    },
    planningAssignment: {
      create: vi.fn(),
    },
  };

  return { tx };
}

describe("createAdHocTaskRecord", () => {
  it("creates one task with participants and no planning assignments", async () => {
    const { tx } = createMockTx();

    const result = await createAdHocTaskRecord(tx as never, {
      personIds: ["person-1", "person-2"],
      naveId: "nave-1",
      estimatedHours: 2,
      notes: "Ajuste urgente",
      createdByUserId: "user-1",
    });

    expect(result).toEqual({ taskId: "task-1" });
    expect(tx.task.create).toHaveBeenCalledOnce();
    expect(tx.planningAssignment.create).not.toHaveBeenCalled();
    expect(tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estimatedHours: 2,
          systemKind: TaskSystemKind.AD_HOC,
          naveId: "nave-1",
          notes: "Ajuste urgente",
          process: IMPREVISTA_PROCESS_CODE,
          participants: {
            createMany: {
              data: [{ personId: "person-1" }, { personId: "person-2" }],
            },
          },
        }),
      }),
    );
  });

  it("deduplicates repeated operator ids", async () => {
    const { tx } = createMockTx();

    await createAdHocTaskRecord(tx as never, {
      personIds: ["person-1", "person-1"],
      naveId: "nave-1",
      estimatedHours: 1,
      createdByUserId: "user-1",
    });

    expect(tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: {
            createMany: {
              data: [{ personId: "person-1" }],
            },
          },
        }),
      }),
    );
  });
});
