import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import type { ProcessCode } from "@/types/process";
import { prisma } from "@/lib/db";
import { taskChainKey } from "@/features/planning/task-chain-key";
import {
  loadTaskNaveContext,
  resolveNaveForElementProcess,
} from "@/features/projects/task-nave";

import {
  injectTransportBlueprints,
  loadTransportDefaultHours,
} from "@/features/projects/transport-tasks";

export interface TaskBlueprint {
  process: ProcessCode;
  estimatedHours: number;
  order: number;
  naveId: string;
  systemKind?: TaskSystemKind | null;
  transportFromNaveId?: string | null;
  transportToNaveId?: string | null;
}

export interface ElementProcessInput {
  process: ProcessCode;
  hoursPerUnit: number;
  fixedHours: number;
  sequence: number;
  naveId?: string | null;
}

/** @deprecated Use ElementProcessInput */
export type FrameProcessInput = ElementProcessInput;

/** Etiqueta de una unidad física (p. ej. «Panel tela 1», «Panel tela 2»). */
export function formatLampElementUnitLabel(
  elementName: string,
  unitIndex: number,
  totalUnits: number,
): string {
  if (totalUnits > 1) return `${elementName} ${unitIndex}`;
  return elementName;
}

/** @deprecated Use formatLampElementUnitLabel */
export const formatLampFrameUnitLabel = formatLampElementUnitLabel;

export interface TaskHoursAggregate {
  process: ProcessCode;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  units: number;
  minOrder: number;
  taskIds: string[];
}

export interface ElementTaskGroup<T> {
  key: string;
  elementTypeName: string;
  surfaceM2: number | null;
  unitCount: number;
  tasks: T[];
}

/** @deprecated Use ElementTaskGroup */
export type BastidorTaskGroup<T> = ElementTaskGroup<T> & {
  frameTypeName: string;
};

/** Horas de secado estándar del proceso (catálogo), independientes del orden en la lámpara. */
export function dryWaitHoursForProcess(
  process: ProcessCode,
  waitHoursByProcess: Record<string, number>,
): number {
  return waitHoursByProcess[process] ?? 0;
}

/** Suma horas de tareas repetidas (misma lámpara/bastidor, varias unidades). */
export function aggregateTasksByProcess<
  T extends {
    id: string;
    process: ProcessCode;
    estimatedHours: number;
    doneHours: number;
    pendingHours: number;
    order: number;
  },
>(tasks: T[]): TaskHoursAggregate[] {
  const byProcess = new Map<ProcessCode, TaskHoursAggregate>();
  for (const task of tasks) {
    const existing = byProcess.get(task.process);
    if (existing) {
      existing.estimatedHours += task.estimatedHours;
      existing.doneHours += task.doneHours;
      existing.pendingHours += task.pendingHours;
      existing.units += 1;
      existing.minOrder = Math.min(existing.minOrder, task.order);
      existing.taskIds.push(task.id);
    } else {
      byProcess.set(task.process, {
        process: task.process,
        estimatedHours: task.estimatedHours,
        doneHours: task.doneHours,
        pendingHours: task.pendingHours,
        units: 1,
        minOrder: task.order,
        taskIds: [task.id],
      });
    }
  }
  return [...byProcess.values()].sort((a, b) => a.minOrder - b.minOrder);
}

export function groupTasksByElement<
  T extends {
    order: number;
    lampElement: {
      id: string;
      label: string | null;
      surfaceM2: number | null;
      elementType: { id: string; name: string };
    } | null;
  },
>(tasks: T[]): ElementTaskGroup<T>[] {
  const groups = new Map<
    string,
    ElementTaskGroup<T> & { unitElementIds: Set<string> }
  >();

  for (const task of tasks) {
    const le = task.lampElement;
    const key = le ? le.elementType.id : "__sin_elemento__";
    const elementTypeName = le?.elementType.name ?? "Sin elemento";
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
      if (le && !existing.unitElementIds.has(le.id)) {
        existing.unitElementIds.add(le.id);
        existing.unitCount += 1;
      }
    } else {
      groups.set(key, {
        key,
        elementTypeName,
        surfaceM2: le?.surfaceM2 ?? null,
        unitCount: le ? 1 : 0,
        unitElementIds: le ? new Set([le.id]) : new Set(),
        tasks: [task],
      });
    }
  }

  return [...groups.values()]
    .map(({ unitElementIds: _ids, ...group }) => group)
    .sort(
      (a, b) =>
        Math.min(...a.tasks.map((t) => t.order)) -
        Math.min(...b.tasks.map((t) => t.order)),
    );
}

/** @deprecated Use groupTasksByElement */
export function groupTasksByBastidor<
  T extends {
    order: number;
    lampFrame?: {
      id: string;
      label: string | null;
      surfaceM2: number | null;
      elementType: { id: string; name: string };
    } | null;
    lampElement?: {
      id: string;
      label: string | null;
      surfaceM2: number | null;
      elementType: { id: string; name: string };
    } | null;
  },
>(tasks: T[]): Array<ElementTaskGroup<T> & { frameTypeName: string }> {
  const normalized = tasks.map((t) => ({
    ...t,
    lampElement:
      t.lampElement ??
      (t.lampFrame
        ? {
            id: t.lampFrame.id,
            label: t.lampFrame.label,
            surfaceM2: t.lampFrame.surfaceM2,
            elementType: t.lampFrame.elementType,
          }
        : null),
  }));
  return groupTasksByElement(normalized).map((g) => ({
    ...g,
    frameTypeName: g.elementTypeName,
  }));
}

export function scaleBlueprintHoursForUnits(
  blueprints: TaskBlueprint[],
  units: number,
): TaskBlueprint[] {
  if (units <= 1) return blueprints;
  return blueprints.map((bp) => ({
    ...bp,
    estimatedHours: bp.estimatedHours * units,
  }));
}

export function computeTaskBlueprintsFromProcesses(
  processes: Array<ElementProcessInput & { naveId?: string | null }>,
  surfaceM2: number,
  fallbackNaveId = "",
): TaskBlueprint[] {
  const sorted = [...processes].sort((a, b) => a.sequence - b.sequence);
  const blueprints: TaskBlueprint[] = [];
  let order = 0;
  for (const fp of sorted) {
    const hours = fp.hoursPerUnit * surfaceM2 + fp.fixedHours;
    if (hours <= 0) continue;
    blueprints.push({
      process: fp.process,
      estimatedHours: hours,
      order: order++,
      naveId: fp.naveId ?? fallbackNaveId,
    });
  }
  return blueprints;
}

export async function buildTasksFromElement(
  elementTypeId: string,
  surfaceM2: number,
): Promise<TaskBlueprint[]> {
  const [elementProcesses, { fallbackNaveId, elementTypeDefaultNaves }, defaultTransportHours] =
    await Promise.all([
      prisma.elementTypeProcess.findMany({
        where: { elementTypeId },
        orderBy: { sequence: "asc" },
      }),
      loadTaskNaveContext(prisma),
      loadTransportDefaultHours(prisma),
    ]);

  const blueprints = computeTaskBlueprintsFromProcesses(
    elementProcesses.map((fp) => ({
      process: fp.process as ProcessCode,
      hoursPerUnit: fp.hoursPerUnit,
      fixedHours: fp.fixedHours,
      sequence: fp.sequence,
      naveId: resolveNaveForElementProcess({
        processNaveId: fp.naveId,
        elementTypeId,
        elementTypeDefaultNaves,
        fallbackNaveId,
      }),
    })),
    surfaceM2,
  );

  return injectTransportBlueprints(blueprints, defaultTransportHours);
}

/** @deprecated Use buildTasksFromElement */
export const buildTasksFromFrame = buildTasksFromElement;

export function adjustPendingOnEstimateChange(
  estimatedHours: number,
  doneHours: number,
  currentPending: number,
): number {
  const minPending = Math.max(0, estimatedHours - doneHours);
  return Math.max(minPending, Math.min(currentPending, estimatedHours));
}

export async function getNextTaskOrder(
  tx: Prisma.TransactionClient,
  lampId: string,
): Promise<number> {
  const agg = await tx.task.aggregate({
    where: { lampId },
    _max: { order: true },
  });
  return (agg._max.order ?? -1) + 1;
}

export function filterUnlockedTasks<
  T extends {
    id: string;
    lampId: string;
    lampElementId?: string | null;
    order: number;
    pendingHours: number;
    isCompleted?: boolean;
  },
>(tasks: T[]): T[] {
  const byChain = new Map<string, T[]>();
  for (const t of tasks) {
    const key = taskChainKey(t);
    const list = byChain.get(key) ?? [];
    list.push(t);
    byChain.set(key, list);
  }
  for (const list of byChain.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  return tasks.filter((task) => {
    const chainTasks = byChain.get(taskChainKey(task)) ?? [];
    for (const prev of chainTasks) {
      if (prev.order >= task.order) break;
      if (typeof prev.isCompleted === "boolean") {
        if (!prev.isCompleted) return false;
        continue;
      }
      if (prev.pendingHours > 0) return false;
    }
    return true;
  });
}

export async function isTaskUnlocked(
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: {
      lampId: true,
      lampElementId: true,
      order: true,
      isCompleted: true,
      systemKind: true,
    },
  });
  if (!task) return false;
  if (task.isCompleted) return false;
  if (task.systemKind === TaskSystemKind.AD_HOC) return true;

  const blockers = await tx.task.count({
    where: {
      lampId: task.lampId,
      lampElementId: task.lampElementId,
      order: { lt: task.order },
      isCompleted: false,
    },
  });
  return blockers === 0;
}
