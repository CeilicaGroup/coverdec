import type { Prisma } from "@/generated/prisma";
import type { ProcessCode } from "@/types/process";
import { prisma } from "@/lib/db";

export interface TaskBlueprint {
  process: ProcessCode;
  estimatedHours: number;
  order: number;
}

export interface FrameProcessInput {
  process: ProcessCode;
  hoursPerUnit: number;
  fixedHours: number;
  sequence: number;
}

/** Etiqueta de una unidad física (p. ej. «Panel tela 1», «Panel tela 2»). */
export function formatLampFrameUnitLabel(
  frameName: string,
  unitIndex: number,
  totalUnits: number,
): string {
  if (totalUnits > 1) return `${frameName} ${unitIndex}`;
  return frameName;
}

export interface TaskHoursAggregate {
  process: ProcessCode;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  units: number;
  minOrder: number;
  taskIds: string[];
}

export interface BastidorTaskGroup<T> {
  key: string;
  frameTypeName: string;
  surfaceM2: number | null;
  unitCount: number;
  tasks: T[];
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

export function groupTasksByBastidor<
  T extends {
    order: number;
    lampFrame: {
      id: string;
      label: string | null;
      surfaceM2: number | null;
      frameType: { id: string; name: string };
    } | null;
  },
>(tasks: T[]): BastidorTaskGroup<T>[] {
  const groups = new Map<
    string,
    BastidorTaskGroup<T> & { unitFrameIds: Set<string> }
  >();

  for (const task of tasks) {
    const lf = task.lampFrame;
    const key = lf ? lf.frameType.id : "__sin_bastidor__";
    const frameTypeName = lf?.frameType.name ?? "Sin bastidor";
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
      if (lf && !existing.unitFrameIds.has(lf.id)) {
        existing.unitFrameIds.add(lf.id);
        existing.unitCount += 1;
      }
    } else {
      groups.set(key, {
        key,
        frameTypeName,
        surfaceM2: lf?.surfaceM2 ?? null,
        unitCount: lf ? 1 : 0,
        unitFrameIds: lf ? new Set([lf.id]) : new Set(),
        tasks: [task],
      });
    }
  }

  return [...groups.values()]
    .map(({ unitFrameIds: _ids, ...group }) => group)
    .sort(
      (a, b) =>
        Math.min(...a.tasks.map((t) => t.order)) -
        Math.min(...b.tasks.map((t) => t.order)),
    );
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
  processes: FrameProcessInput[],
  surfaceM2: number,
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
    });
  }
  return blueprints;
}

export async function buildTasksFromFrame(
  frameTypeId: string,
  surfaceM2: number,
): Promise<TaskBlueprint[]> {
  const frameProcesses = await prisma.frameTypeProcess.findMany({
    where: { frameTypeId },
    orderBy: { sequence: "asc" },
  });
  return computeTaskBlueprintsFromProcesses(
    frameProcesses.map((fp) => ({
      process: fp.process as ProcessCode,
      hoursPerUnit: fp.hoursPerUnit,
      fixedHours: fp.fixedHours,
      sequence: fp.sequence,
    })),
    surfaceM2,
  );
}

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
  T extends { id: string; lampId: string; order: number; pendingHours: number; isCompleted?: boolean },
>(tasks: T[]): T[] {
  const byLamp = new Map<string, T[]>();
  for (const t of tasks) {
    const list = byLamp.get(t.lampId) ?? [];
    list.push(t);
    byLamp.set(t.lampId, list);
  }
  for (const list of byLamp.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  return tasks.filter((task) => {
    const lampTasks = byLamp.get(task.lampId) ?? [];
    for (const prev of lampTasks) {
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
    select: { lampId: true, order: true, isCompleted: true },
  });
  if (!task) return false;
  if (task.isCompleted) return false;

  const blockers = await tx.task.count({
    where: {
      lampId: task.lampId,
      order: { lt: task.order },
      isCompleted: false,
    },
  });
  return blockers === 0;
}
