import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import type { TaskBlueprint } from "@/features/projects/lamp-tasks";
import { taskHasPlanningAssignments } from "@/features/projects/task-planning-lock";

export const TRANSPORT_PROCESS_CODE = "TRANSPORTE";

export function isTransportProcess(process: string): boolean {
  return process === TRANSPORT_PROCESS_CODE;
}

export function isSystemTransportTask(task: {
  systemKind?: TaskSystemKind | null;
  process?: string;
}): boolean {
  return (
    task.systemKind === TaskSystemKind.TRANSPORT ||
    isTransportProcess(task.process ?? "")
  );
}

export function isAutomaticTransportTask(task: {
  systemKind?: TaskSystemKind | null;
}): boolean {
  return task.systemKind === TaskSystemKind.TRANSPORT;
}

export async function loadTransportDefaultHours(
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const definition = await tx.processDefinition.findUnique({
    where: { code: TRANSPORT_PROCESS_CODE },
    select: { setupHours: true },
  });
  const hours = definition?.setupHours ?? 0;
  return hours > 0 ? hours : 0.5;
}

export function injectTransportBlueprints(
  blueprints: TaskBlueprint[],
  defaultHours: number,
): TaskBlueprint[] {
  if (blueprints.length < 2) return blueprints;

  const result: TaskBlueprint[] = [];
  for (let i = 0; i < blueprints.length; i++) {
    const current = blueprints[i]!;
    result.push(current);
    const next = blueprints[i + 1];
    if (!next || current.naveId === next.naveId) continue;

    result.push({
      process: TRANSPORT_PROCESS_CODE,
      estimatedHours: defaultHours,
      order: 0,
      naveId: current.naveId,
      systemKind: TaskSystemKind.TRANSPORT,
      transportFromNaveId: current.naveId,
      transportToNaveId: next.naveId,
    });
  }

  return result.map((blueprint, order) => ({ ...blueprint, order }));
}

interface ChainTaskRow {
  id: string;
  process: string;
  order: number;
  naveId: string;
  estimatedHours: number;
  systemKind: TaskSystemKind | null;
  transportFromNaveId: string | null;
  transportToNaveId: string | null;
  transportAfterTaskId: string | null;
  _count: { assignments: number; timeEntries: number };
}

interface TransportGap {
  afterTaskId: string;
  fromNaveId: string;
  toNaveId: string;
  naveId: string;
}

function taskHasWork(task: ChainTaskRow): boolean {
  return task._count.assignments > 0 || task._count.timeEntries > 0;
}

function computeTransportGaps(productionTasks: ChainTaskRow[]): TransportGap[] {
  const gaps: TransportGap[] = [];
  for (let i = 0; i < productionTasks.length - 1; i++) {
    const current = productionTasks[i]!;
    const next = productionTasks[i + 1]!;
    if (current.naveId === next.naveId) continue;
    gaps.push({
      afterTaskId: current.id,
      fromNaveId: current.naveId,
      toNaveId: next.naveId,
      naveId: current.naveId,
    });
  }
  return gaps;
}

interface ProductionTaskOrderRow {
  id: string;
  order: number;
}

interface TransportTaskOrderRow {
  id: string;
  transportAfterTaskId: string | null;
}

/** Coloca cada transporte justo después de la tarea de producción que enlaza. */
export function buildInterleavedTaskOrder(
  productionTasks: ProductionTaskOrderRow[],
  transportTasks: TransportTaskOrderRow[],
): string[] {
  const sortedProduction = [...productionTasks].sort(
    (a, b) => a.order - b.order,
  );
  const transportByAfter = new Map(
    transportTasks
      .filter((task) => task.transportAfterTaskId)
      .map((task) => [task.transportAfterTaskId!, task]),
  );

  const ordered: string[] = [];
  const usedTransportIds = new Set<string>();

  for (const prod of sortedProduction) {
    ordered.push(prod.id);
    const transport = transportByAfter.get(prod.id);
    if (transport) {
      ordered.push(transport.id);
      usedTransportIds.add(transport.id);
    }
  }

  for (const transport of transportTasks) {
    if (!usedTransportIds.has(transport.id)) {
      ordered.push(transport.id);
    }
  }

  return ordered;
}

async function syncTransportTasksForChain(
  tx: Prisma.TransactionClient,
  params: {
    projectId: string;
    lampId: string;
    lampElementId: string | null;
    tasks: ChainTaskRow[];
    defaultTransportHours: number;
  },
): Promise<void> {
  if (params.tasks.some((task) => taskHasPlanningAssignments(task))) {
    return;
  }

  const productionTasks = params.tasks
    .filter((task) => !isAutomaticTransportTask(task))
    .sort((a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"));

  const transportTasks = params.tasks
    .filter((task) => isAutomaticTransportTask(task))
    .sort((a, b) => a.order - b.order);

  const gaps = computeTransportGaps(productionTasks);
  const transportByAfter = new Map(
    transportTasks
      .filter((task) => task.transportAfterTaskId)
      .map((task) => [task.transportAfterTaskId!, task]),
  );

  const matchedTransportIds = new Set<string>();
  for (const gap of gaps) {
    const existing = transportByAfter.get(gap.afterTaskId);
    if (existing) matchedTransportIds.add(existing.id);
  }

  for (const transport of transportTasks) {
    if (matchedTransportIds.has(transport.id)) continue;
    if (taskHasWork(transport)) {
      throw new Error(
        "Hay un transporte obsoleto con horas o planning registrados; revísalo antes de cambiar naves.",
      );
    }
    await tx.task.delete({ where: { id: transport.id } });
  }

  for (const gap of gaps) {
    const existing = transportByAfter.get(gap.afterTaskId);
    if (existing) {
      if (taskHasWork(existing)) {
        await tx.task.update({
          where: { id: existing.id },
          data: {
            transportFromNaveId: gap.fromNaveId,
            transportToNaveId: gap.toNaveId,
            transportAfterTaskId: gap.afterTaskId,
            workOrderId: null,
            workOrderSequence: null,
          },
        });
        continue;
      }
      await tx.task.update({
        where: { id: existing.id },
        data: {
          naveId: gap.naveId,
          estimatedHours: params.defaultTransportHours,
          transportFromNaveId: gap.fromNaveId,
          transportToNaveId: gap.toNaveId,
          transportAfterTaskId: gap.afterTaskId,
          systemKind: TaskSystemKind.TRANSPORT,
          workOrderId: null,
          workOrderSequence: null,
        },
      });
      continue;
    }

    await tx.task.create({
      data: {
        projectId: params.projectId,
        lampId: params.lampId,
        lampElementId: params.lampElementId,
        process: TRANSPORT_PROCESS_CODE,
        estimatedHours: params.defaultTransportHours,
        order: 0,
        naveId: gap.naveId,
        systemKind: TaskSystemKind.TRANSPORT,
        transportFromNaveId: gap.fromNaveId,
        transportToNaveId: gap.toNaveId,
        transportAfterTaskId: gap.afterTaskId,
        workOrderId: null,
        workOrderSequence: null,
      },
    });
  }

  const refreshed = await tx.task.findMany({
    where: {
      lampId: params.lampId,
      lampElementId: params.lampElementId,
    },
    select: {
      id: true,
      order: true,
      process: true,
      systemKind: true,
      transportAfterTaskId: true,
    },
  });

  const productionRows = refreshed
    .filter((task) => !isAutomaticTransportTask(task))
    .map((task) => ({ id: task.id, order: task.order }));
  const transportRows = refreshed
    .filter((task) => isAutomaticTransportTask(task))
    .map((task) => ({
      id: task.id,
      transportAfterTaskId: task.transportAfterTaskId,
    }));

  const sequence = buildInterleavedTaskOrder(productionRows, transportRows);
  const orderById = new Map(refreshed.map((task) => [task.id, task.order]));

  for (let order = 0; order < sequence.length; order++) {
    const taskId = sequence[order]!;
    if (orderById.get(taskId) !== order) {
      await tx.task.update({
        where: { id: taskId },
        data: { order },
      });
    }
  }
}

export async function syncTransportTasksForLamp(
  tx: Prisma.TransactionClient,
  lampId: string,
  defaultTransportHours?: number,
): Promise<void> {
  const hours =
    defaultTransportHours ?? (await loadTransportDefaultHours(tx));

  const lamp = await tx.lamp.findUnique({
    where: { id: lampId },
    select: { projectId: true },
  });
  if (!lamp) return;

  const tasks = await tx.task.findMany({
    where: { lampId },
    orderBy: [{ lampElementId: "asc" }, { order: "asc" }],
    select: {
      id: true,
      lampElementId: true,
      process: true,
      order: true,
      naveId: true,
      estimatedHours: true,
      systemKind: true,
      transportFromNaveId: true,
      transportToNaveId: true,
      transportAfterTaskId: true,
      _count: { select: { assignments: true, timeEntries: true } },
    },
  });

  const byChain = new Map<string | null, ChainTaskRow[]>();
  for (const task of tasks) {
    const key = task.lampElementId;
    const list = byChain.get(key) ?? [];
    list.push(task);
    byChain.set(key, list);
  }

  for (const [lampElementId, chainTasks] of byChain) {
    if (chainTasks.length === 0) continue;
    await syncTransportTasksForChain(tx, {
      projectId: lamp.projectId,
      lampId,
      lampElementId,
      tasks: chainTasks,
      defaultTransportHours: hours,
    });
  }
}

export function blueprintToTaskCreateData(
  blueprint: TaskBlueprint,
  base: {
    projectId: string;
    lampId: string;
    lampElementId: string;
    order: number;
  },
) {
  return {
    ...base,
    process: blueprint.process,
    estimatedHours: blueprint.estimatedHours,
    naveId: blueprint.naveId,
    systemKind: blueprint.systemKind ?? null,
    transportFromNaveId: blueprint.transportFromNaveId ?? null,
    transportToNaveId: blueprint.transportToNaveId ?? null,
  };
}
