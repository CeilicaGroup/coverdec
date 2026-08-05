import { describe, expect, it, vi } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import { createAdHocTaskRecord } from "@/features/ad-hoc/create-ad-hoc-task";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";

function createMockTx() {
  const tx = {
    project: {
      findFirst: vi.fn(async () => ({
        id: "project-1",
        lamps: [{ id: "lamp-1" }],
      })),
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
  it("creates one task with participants and both notes", async () => {
    const { tx } = createMockTx();

    const result = await createAdHocTaskRecord(tx as never, {
      personIds: ["person-1", "person-2"],
      naveId: "nave-1",
      estimatedHours: 2,
      notes: "Revisar soldadura",
      internalNotes: "Urgencia cliente, no estaba en el plan",
      projectId: "project-1",
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
          projectId: "project-1",
          lampId: "lamp-1",
          notes: "Revisar soldadura",
          internalNotes: "Urgencia cliente, no estaba en el plan",
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
      notes: "Detalle empleado",
      internalNotes: "Motivo interno",
      projectId: "project-1",
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

  it("requires a real project", async () => {
    const { tx } = createMockTx();
    tx.project.findFirst.mockResolvedValueOnce(null as never);

    await expect(
      createAdHocTaskRecord(tx as never, {
        personIds: ["person-1"],
        naveId: "nave-1",
        estimatedHours: 1,
        notes: "Detalle",
        internalNotes: "Motivo",
        projectId: "missing",
        createdByUserId: "user-1",
      }),
    ).rejects.toThrow(/Proyecto no encontrado/);
  });
});
