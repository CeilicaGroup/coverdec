import { describe, expect, it, vi } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import {
  AD_HOC_EDIT_COMPLETED_ERROR,
  AD_HOC_EDIT_PLANNED_ERROR,
  AD_HOC_EDIT_STRUCTURAL_WITH_TIME_ENTRIES_ERROR,
  assertCanEditAdHocTask,
  updateAdHocTaskRecord,
} from "@/features/ad-hoc/update-ad-hoc-task";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";

const baseTask = {
  id: "task-1",
  projectId: "project-1",
  lampId: "lamp-1",
  naveId: "nave-1",
  process: IMPREVISTA_PROCESS_CODE,
  estimatedHours: 2,
  systemKind: TaskSystemKind.AD_HOC,
  isCompleted: false,
  participants: [{ personId: "person-1" }],
  _count: { assignments: 0, timeEntries: 0 },
};

function createMockTx(task = baseTask) {
  const tx = {
    task: {
      findFirst: vi.fn(async () => task),
      update: vi.fn(async () => ({ id: task.id })),
    },
    taskParticipant: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    project: {
      findFirst: vi.fn(async () => ({
        id: "project-2",
        lamps: [{ id: "lamp-2" }],
      })),
    },
  };
  return { tx, task };
}

describe("assertCanEditAdHocTask", () => {
  it("allows pending ad-hoc tasks", () => {
    expect(() =>
      assertCanEditAdHocTask({
        systemKind: TaskSystemKind.AD_HOC,
        isCompleted: false,
        _count: { assignments: 0, timeEntries: 0 },
      }),
    ).not.toThrow();
  });

  it("rejects completed tasks", () => {
    expect(() =>
      assertCanEditAdHocTask({
        systemKind: TaskSystemKind.AD_HOC,
        isCompleted: true,
        _count: { assignments: 0, timeEntries: 0 },
      }),
    ).toThrow(AD_HOC_EDIT_COMPLETED_ERROR);
  });

  it("rejects planned tasks", () => {
    expect(() =>
      assertCanEditAdHocTask({
        systemKind: TaskSystemKind.AD_HOC,
        isCompleted: false,
        _count: { assignments: 1, timeEntries: 0 },
      }),
    ).toThrow(AD_HOC_EDIT_PLANNED_ERROR);
  });
});

describe("updateAdHocTaskRecord", () => {
  it("updates all fields and participants for pending tasks without hours", async () => {
    const { tx } = createMockTx();

    const result = await updateAdHocTaskRecord(tx as never, {
      taskId: "task-1",
      personIds: ["person-1", "person-2"],
      naveId: "nave-2",
      estimatedHours: 3,
      notes: "Nueva instrucción",
      internalNotes: "Nuevo motivo",
      projectId: "project-2",
      process: IMPREVISTA_PROCESS_CODE,
    });

    expect(result).toEqual({ taskId: "task-1" });
    expect(tx.taskParticipant.deleteMany).toHaveBeenCalledWith({
      where: { taskId: "task-1" },
    });
    expect(tx.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-1" },
        data: expect.objectContaining({
          projectId: "project-2",
          lampId: "lamp-2",
          naveId: "nave-2",
          estimatedHours: 3,
          notes: "Nueva instrucción",
          internalNotes: "Nuevo motivo",
          participants: {
            createMany: {
              data: [{ personId: "person-1" }, { personId: "person-2" }],
            },
          },
        }),
      }),
    );
  });

  it("updates only notes when the task has time entries", async () => {
    const { tx } = createMockTx({
      ...baseTask,
      _count: { assignments: 0, timeEntries: 2 },
    });

    await updateAdHocTaskRecord(tx as never, {
      taskId: "task-1",
      personIds: ["person-1"],
      naveId: "nave-1",
      estimatedHours: 2,
      notes: "Nota actualizada",
      internalNotes: "Motivo actualizado",
      projectId: "project-1",
      process: IMPREVISTA_PROCESS_CODE,
    });

    expect(tx.taskParticipant.deleteMany).not.toHaveBeenCalled();
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        notes: "Nota actualizada",
        internalNotes: "Motivo actualizado",
      },
    });
  });

  it("rejects structural changes when the task has time entries", async () => {
    const { tx } = createMockTx({
      ...baseTask,
      _count: { assignments: 0, timeEntries: 1 },
    });

    await expect(
      updateAdHocTaskRecord(tx as never, {
        taskId: "task-1",
        personIds: ["person-2"],
        naveId: "nave-1",
        estimatedHours: 2,
        notes: "Nota",
        internalNotes: "Motivo",
        projectId: "project-1",
        process: IMPREVISTA_PROCESS_CODE,
      }),
    ).rejects.toThrow(AD_HOC_EDIT_STRUCTURAL_WITH_TIME_ENTRIES_ERROR);
  });

  it("rejects tasks with planning assignments", async () => {
    const { tx } = createMockTx({
      ...baseTask,
      _count: { assignments: 1, timeEntries: 0 },
    });

    await expect(
      updateAdHocTaskRecord(tx as never, {
        taskId: "task-1",
        personIds: ["person-1"],
        naveId: "nave-1",
        estimatedHours: 2,
        notes: "Nota",
        internalNotes: "Motivo",
        projectId: "project-1",
        process: IMPREVISTA_PROCESS_CODE,
      }),
    ).rejects.toThrow(AD_HOC_EDIT_PLANNED_ERROR);
  });
});
