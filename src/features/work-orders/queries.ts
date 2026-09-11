import { prisma } from "@/lib/db";
import type { WorkOrderStatus } from "@/generated/prisma";
import { workOrderGroupKey } from "./group-key";
import { excludeWorkOrderExemptTasksWhere } from "./task-ot-exemptions";

const eligibleTaskInclude = {
  project: { select: { id: true, name: true, code: true, kind: true } },
  lamp: {
    select: {
      id: true,
      name: true,
      elementType: { select: { id: true, name: true, typology: true } },
    },
  },
  lampElement: {
    select: {
      id: true,
      label: true,
      elementType: { select: { id: true, name: true, typology: true } },
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
      ...excludeWorkOrderExemptTasksWhere(),
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
      ...excludeWorkOrderExemptTasksWhere(),
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

/**
 * Current executors per work order, for the "elegir ejecutores" picker —
 * reads ALL PlanningAssignment rows (draft or published), unlike
 * loadAssigneeByTaskIds (display-context.ts) which only shows published
 * assignments. A draft-only plan must still prefill the picker correctly.
 */
export async function loadWorkOrderExecutorIds(
  workOrderIds: string[],
): Promise<Map<string, string[]>> {
  if (workOrderIds.length === 0) return new Map();

  const rows = await prisma.task.findMany({
    where: { workOrderId: { in: workOrderIds }, isCompleted: false },
    select: {
      workOrderId: true,
      assignments: { select: { personId: true } },
    },
  });

  const byWorkOrder = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.workOrderId) continue;
    const set = byWorkOrder.get(row.workOrderId) ?? new Set<string>();
    for (const a of row.assignments) set.add(a.personId);
    byWorkOrder.set(row.workOrderId, set);
  }

  return new Map([...byWorkOrder.entries()].map(([id, set]) => [id, [...set]]));
}

export interface ActivePersonOption {
  id: string;
  iniciales: string;
  label: string;
  naveIds: string[];
}

/** For the "elegir ejecutores de OT" picker: active people, grouped by nave. */
export async function listActivePeopleForExecutorPicker(): Promise<ActivePersonOption[]> {
  const people = await prisma.person.findMany({
    where: { isActive: true },
    select: {
      id: true,
      iniciales: true,
      user: { select: { name: true } },
      personNaves: { select: { naveId: true } },
    },
    orderBy: { iniciales: "asc" },
  });
  return people.map((p) => ({
    id: p.id,
    iniciales: p.iniciales,
    label: p.user?.name ?? p.iniciales,
    naveIds: p.personNaves.map((pn) => pn.naveId),
  }));
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
