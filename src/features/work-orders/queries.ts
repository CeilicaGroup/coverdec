import { prisma } from "@/lib/db";
import type { WorkOrderStatus } from "@/generated/prisma";
import { workOrderGroupKey } from "./group-key";

const eligibleTaskInclude = {
  project: { select: { id: true, name: true, code: true } },
  lamp: {
    select: {
      id: true,
      name: true,
      elementType: { select: { id: true, name: true } },
    },
  },
  lampElement: {
    select: {
      id: true,
      label: true,
      elementType: { select: { id: true, name: true } },
    },
  },
  nave: { select: { id: true, codigo: true, nombre: true } },
  processDefinition: { select: { code: true, label: true } },
} as const;

export async function listWorkOrders(status?: WorkOrderStatus | "ALL") {
  const where =
    status && status !== "ALL" ? { status } : undefined;

  return prisma.workOrder.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      tasks: {
        orderBy: { workOrderSequence: "asc" },
        include: eligibleTaskInclude,
      },
    },
  });
}

export async function getWorkOrderById(id: string) {
  return prisma.workOrder.findUnique({
    where: { id },
    include: {
      tasks: {
        orderBy: { workOrderSequence: "asc" },
        include: eligibleTaskInclude,
      },
    },
  });
}

export async function listEligibleTasksForWorkOrder() {
  return prisma.task.findMany({
    where: {
      isCompleted: false,
      workOrderId: null,
      project: { isActive: true },
    },
    orderBy: [
      { project: { name: "asc" } },
      { lamp: { name: "asc" } },
      { order: "asc" },
    ],
    include: eligibleTaskInclude,
  });
}

export type EligibleWorkOrderTask = Awaited<
  ReturnType<typeof listEligibleTasksForWorkOrder>
>[number];

export async function loadPendingTasksForAutoGroup() {
  return prisma.task.findMany({
    where: {
      isCompleted: false,
      workOrderId: null,
      project: { isActive: true },
    },
    select: {
      id: true,
      process: true,
      lampElement: {
        select: { elementType: { select: { id: true } } },
      },
      lamp: {
        select: { elementType: { select: { id: true } } },
      },
    },
  });
}

export function groupTasksForAutoWorkOrders<
  T extends Parameters<typeof workOrderGroupKey>[0] & { id: string },
>(tasks: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const key = workOrderGroupKey(task) ?? `task:${task.id}`;
    const list = groups.get(key) ?? [];
    list.push(task);
    groups.set(key, list);
  }
  return groups;
}

export async function workOrdersHaveTimeEntries(
  workOrderIds: string[],
): Promise<Set<string>> {
  if (workOrderIds.length === 0) return new Set();

  const rows = await prisma.task.findMany({
    where: {
      workOrderId: { in: workOrderIds },
      timeEntries: { some: {} },
    },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  });

  return new Set(
    rows
      .map((row) => row.workOrderId)
      .filter((id): id is string => id != null),
  );
}

export async function workOrdersHavePlanningAssignments(
  workOrderIds: string[],
): Promise<Set<string>> {
  if (workOrderIds.length === 0) return new Set();

  const rows = await prisma.task.findMany({
    where: {
      workOrderId: { in: workOrderIds },
      assignments: { some: {} },
    },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  });

  return new Set(
    rows
      .map((row) => row.workOrderId)
      .filter((id): id is string => id != null),
  );
}
