import { describe, expect, it, vi, beforeEach } from "vitest";
import { TaskSystemKind, WorkOrderStatus } from "@/generated/prisma";

const { prismaTaskFindMany, loadDoneHoursByTaskIds } = vi.hoisted(() => ({
  prismaTaskFindMany: vi.fn(),
  loadDoneHoursByTaskIds: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      findMany: prismaTaskFindMany,
    },
  },
}));

vi.mock("@/features/time-tracking/task-hours-derived", () => ({
  loadDoneHoursByTaskIds,
  computeTaskPlanningTotals: ({
    estimatedHours,
    doneHours,
    priorPlannedHours,
  }: {
    estimatedHours: number;
    doneHours: number;
    priorPlannedHours: number;
  }) => ({
    pendingToPlanHours: Math.max(
      0,
      estimatedHours - doneHours - priorPlannedHours,
    ),
    remainingWorkHours: Math.max(0, estimatedHours - doneHours),
  }),
}));

import { assertNaveSchedulableTasksHaveOpenWorkOrder } from "../require-for-planning";

describe("assertNaveSchedulableTasksHaveOpenWorkOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDoneHoursByTaskIds.mockResolvedValue(new Map());
  });

  it("throws before solver load when a schedulable task has no open work order", async () => {
    prismaTaskFindMany.mockResolvedValue([
      {
        id: "t1",
        process: "EMBALAJE",
        systemKind: null,
        estimatedHours: 4,
        isCompleted: false,
        workOrderId: null,
        workOrder: null,
        project: { name: "Proyecto" },
        lamp: { name: "L1" },
        processDefinition: { label: "Embalaje" },
      },
    ]);

    await expect(
      assertNaveSchedulableTasksHaveOpenWorkOrder({
        naveId: "nave-1",
        weekStart: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("sin OT abierta");
  });

  it("ignores tasks with no pending hours", async () => {
    prismaTaskFindMany.mockResolvedValue([
      {
        id: "t1",
        process: "EMBALAJE",
        systemKind: null,
        estimatedHours: 4,
        isCompleted: false,
        workOrderId: null,
        workOrder: null,
        project: { name: "Proyecto" },
        lamp: { name: "L1" },
        processDefinition: { label: "Embalaje" },
      },
    ]);
    loadDoneHoursByTaskIds.mockResolvedValue(new Map([["t1", 4]]));

    await expect(
      assertNaveSchedulableTasksHaveOpenWorkOrder({
        naveId: "nave-1",
        weekStart: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when schedulable tasks have an open work order", async () => {
    prismaTaskFindMany.mockResolvedValue([
      {
        id: "t1",
        process: "EMBALAJE",
        systemKind: null,
        estimatedHours: 4,
        isCompleted: false,
        workOrderId: "wo-1",
        workOrder: { status: WorkOrderStatus.OPEN, number: "OT0001-2026" },
        project: { name: "Proyecto" },
        lamp: { name: "L1" },
        processDefinition: { label: "Embalaje" },
      },
    ]);

    await expect(
      assertNaveSchedulableTasksHaveOpenWorkOrder({
        naveId: "nave-1",
        weekStart: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores transport tasks without work order", async () => {
    prismaTaskFindMany.mockResolvedValue([
      {
        id: "t-transport",
        process: "TRANSPORTE",
        systemKind: TaskSystemKind.TRANSPORT,
        estimatedHours: 0.5,
        isCompleted: false,
        workOrderId: null,
        workOrder: null,
        project: { name: "Proyecto" },
        lamp: { name: "L1" },
        processDefinition: { label: "Transporte" },
      },
    ]);

    await expect(
      assertNaveSchedulableTasksHaveOpenWorkOrder({
        naveId: "nave-1",
        weekStart: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores imprevista tasks without work order", async () => {
    prismaTaskFindMany.mockResolvedValue([
      {
        id: "t-imprevista",
        process: "IMPREVISTA",
        systemKind: TaskSystemKind.AD_HOC,
        estimatedHours: 1,
        isCompleted: false,
        workOrderId: null,
        workOrder: null,
        project: { name: "Imprevistas" },
        lamp: { name: "Pool" },
        processDefinition: { label: "Imprevista" },
      },
    ]);

    await expect(
      assertNaveSchedulableTasksHaveOpenWorkOrder({
        naveId: "nave-1",
        weekStart: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });
});
