import type { Prisma } from "@/generated/prisma";
import {
  adjustPendingOnEstimateChange,
  buildTasksFromFrame,
  formatLampFrameUnitLabel,
  type TaskBlueprint,
} from "@/features/projects/lamp-tasks";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";

export interface LampFrameConfig {
  frameTypeId: string;
  surfaceM2: number;
  units: number;
}

interface LampFrameRow {
  id: string;
  frameTypeId: string;
  label: string | null;
  surfaceM2: number | null;
  tasks: Array<{
    id: string;
    process: string;
    estimatedHours: number;
    order: number;
    _count: { assignments: number; timeEntries: number };
  }>;
}

function frameHasWork(frame: LampFrameRow): boolean {
  return frame.tasks.some(
    (t) => t._count.assignments > 0 || t._count.timeEntries > 0,
  );
}

function taskHasWork(task: LampFrameRow["tasks"][number]): boolean {
  return task._count.assignments > 0 || task._count.timeEntries > 0;
}

/** Agrupa unidades físicas (LampFrame) en configuración editable por tipo de bastidor. */
export function lampFramesToConfig(
  frames: Array<{
    frameTypeId: string;
    surfaceM2: number | null;
  }>,
): LampFrameConfig[] {
  const groups = new Map<string, LampFrameConfig>();
  for (const frame of frames) {
    const existing = groups.get(frame.frameTypeId);
    if (existing) {
      existing.units += 1;
    } else {
      groups.set(frame.frameTypeId, {
        frameTypeId: frame.frameTypeId,
        surfaceM2: frame.surfaceM2 ?? 0,
        units: 1,
      });
    }
  }
  return [...groups.values()];
}

export function fallbackLampConfig(lamp: {
  frameTypeId: string;
  surfaceM2: number | null;
  units: number;
}): LampFrameConfig[] {
  return [
    {
      frameTypeId: lamp.frameTypeId,
      surfaceM2: lamp.surfaceM2 ?? 0,
      units: lamp.units,
    },
  ];
}

async function applyBlueprintHours(
  tx: Prisma.TransactionClient,
  taskId: string,
  newEstimate: number,
  doneHours: number,
): Promise<void> {
  await tx.task.update({
    where: { id: taskId },
    data: { estimatedHours: newEstimate },
  });
}

async function recalcFrameTasks(
  tx: Prisma.TransactionClient,
  frame: LampFrameRow,
  blueprints: TaskBlueprint[],
  doneByTaskId: Map<string, number>,
): Promise<void> {
  const blueprintByProcess = new Map(blueprints.map((bp) => [bp.process, bp]));

  for (const task of frame.tasks) {
    const bp = blueprintByProcess.get(task.process);
    if (!bp) continue;

    const doneHours = doneByTaskId.get(task.id) ?? 0;
    if (taskHasWork(task) && doneHours > 0) {
      const nextEstimate = adjustPendingOnEstimateChange(
        bp.estimatedHours,
        doneHours,
        Math.max(0, task.estimatedHours - doneHours),
      );
      if (Math.abs(nextEstimate - task.estimatedHours) > 0.001) {
        await applyBlueprintHours(tx, task.id, nextEstimate, doneHours);
      }
      continue;
    }

    if (taskHasWork(task)) {
      if (Math.abs(bp.estimatedHours - task.estimatedHours) > 0.001) {
        await applyBlueprintHours(tx, task.id, bp.estimatedHours, doneHours);
      }
      continue;
    }

    await applyBlueprintHours(tx, task.id, bp.estimatedHours, doneHours);
  }
}

async function createFrameWithTasks(
  tx: Prisma.TransactionClient,
  params: {
    lampId: string;
    projectId: string;
    naveId: string;
    frameTypeId: string;
    frameName: string;
    surfaceM2: number;
    unitIndex: number;
    totalUnits: number;
    blueprints: TaskBlueprint[];
    physicalFrameIndex: number;
  },
): Promise<void> {
  const {
    lampId,
    projectId,
    naveId,
    frameTypeId,
    frameName,
    surfaceM2,
    unitIndex,
    totalUnits,
    blueprints,
    physicalFrameIndex,
  } = params;

  const lampFrame = await tx.lampFrame.create({
    data: {
      lampId,
      frameTypeId,
      label: formatLampFrameUnitLabel(frameName, unitIndex, totalUnits),
      surfaceM2,
      units: 1,
    },
  });

  if (blueprints.length === 0) return;

  await tx.task.createMany({
    data: blueprints.map((bp) => ({
      projectId,
      lampId,
      lampFrameId: lampFrame.id,
      process: bp.process,
      estimatedHours: bp.estimatedHours,
      order: bp.order + physicalFrameIndex * 1000,
      naveId,
    })),
  });
}

async function removeFrameIfAllowed(
  tx: Prisma.TransactionClient,
  frame: LampFrameRow,
): Promise<void> {
  if (frameHasWork(frame)) {
    throw new Error(
      `No se puede quitar «${frame.label ?? "unidad"}»: tiene horas o planificación registradas.`,
    );
  }
  await tx.task.deleteMany({ where: { lampFrameId: frame.id } });
  await tx.lampFrame.delete({ where: { id: frame.id } });
}

async function relabelFrames(
  tx: Prisma.TransactionClient,
  frames: LampFrameRow[],
  frameName: string,
  totalUnits: number,
): Promise<void> {
  const sorted = [...frames].sort((a, b) =>
    (a.label ?? "").localeCompare(b.label ?? "", undefined, { numeric: true }),
  );
  for (let i = 0; i < sorted.length; i++) {
    const label = formatLampFrameUnitLabel(frameName, i + 1, totalUnits);
    if (sorted[i]!.label !== label) {
      await tx.lampFrame.update({
        where: { id: sorted[i]!.id },
        data: { label },
      });
    }
  }
}

export async function syncLampFrames(
  tx: Prisma.TransactionClient,
  params: {
    lampId: string;
    projectId: string;
    naveId: string;
    frames: LampFrameConfig[];
  },
): Promise<void> {
  const { lampId, projectId, naveId, frames } = params;

  if (frames.length === 0) {
    throw new Error("La lámpara debe tener al menos un bastidor.");
  }

  const lamp = await tx.lamp.findFirst({
    where: { id: lampId },
    include: {
      frames: {
        orderBy: { createdAt: "asc" },
        include: {
          tasks: {
            include: {
              _count: { select: { assignments: true, timeEntries: true } },
            },
          },
        },
      },
    },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  const frameTypeIds = [...new Set(frames.map((f) => f.frameTypeId))];
  const frameTypes = await tx.frameType.findMany({
    where: { id: { in: frameTypeIds } },
    select: { id: true, name: true },
  });
  const frameNameById = new Map(frameTypes.map((f) => [f.id, f.name]));
  if (frameTypes.length !== frameTypeIds.length) {
    throw new Error("Alguno de los bastidores seleccionados no existe.");
  }

  const existingByType = new Map<string, LampFrameRow[]>();
  for (const frame of lamp.frames) {
    const list = existingByType.get(frame.frameTypeId) ?? [];
    list.push(frame);
    existingByType.set(frame.frameTypeId, list);
  }

  const desiredTypeIds = new Set(frameTypeIds);

  for (const [frameTypeId, existingFrames] of existingByType) {
    if (!desiredTypeIds.has(frameTypeId)) {
      for (const frame of [...existingFrames].reverse()) {
        await removeFrameIfAllowed(tx, frame);
      }
    }
  }

  for (const config of frames) {
    const frameName = frameNameById.get(config.frameTypeId) ?? "Bastidor";
    const blueprints = await buildTasksFromFrame(
      config.frameTypeId,
      config.surfaceM2,
    );
    if (blueprints.length === 0) {
      throw new Error(
        `«${frameName}» no genera tareas con ${config.surfaceM2} m².`,
      );
    }

    let existingFrames = existingByType.get(config.frameTypeId) ?? [];
    const currentCount = existingFrames.length;

    if (currentCount === 0) {
      for (let unitIndex = 1; unitIndex <= config.units; unitIndex++) {
        const physicalFrameIndex = await tx.lampFrame.count({ where: { lampId } });
        await createFrameWithTasks(tx, {
          lampId,
          projectId,
          naveId,
          frameTypeId: config.frameTypeId,
          frameName,
          surfaceM2: config.surfaceM2,
          unitIndex,
          totalUnits: config.units,
          blueprints,
          physicalFrameIndex,
        });
      }
      continue;
    }

    const taskIds = existingFrames.flatMap((f) => f.tasks.map((t) => t.id));
    const doneByTaskId = await loadDoneHoursByTaskIds(tx, taskIds);

    for (const frame of existingFrames) {
      if (frame.surfaceM2 !== config.surfaceM2) {
        await tx.lampFrame.update({
          where: { id: frame.id },
          data: { surfaceM2: config.surfaceM2 },
        });
        await recalcFrameTasks(tx, frame, blueprints, doneByTaskId);
      }
    }

    if (config.units > currentCount) {
      for (let unitIndex = currentCount + 1; unitIndex <= config.units; unitIndex++) {
        const physicalFrameIndex = await tx.lampFrame.count({ where: { lampId } });
        await createFrameWithTasks(tx, {
          lampId,
          projectId,
          naveId,
          frameTypeId: config.frameTypeId,
          frameName,
          surfaceM2: config.surfaceM2,
          unitIndex,
          totalUnits: config.units,
          blueprints,
          physicalFrameIndex,
        });
      }
      existingFrames = (await tx.lampFrame.findMany({
        where: { lampId, frameTypeId: config.frameTypeId },
        orderBy: { createdAt: "asc" },
        include: {
          tasks: {
            include: {
              _count: { select: { assignments: true, timeEntries: true } },
            },
          },
        },
      })) as LampFrameRow[];
    } else if (config.units < currentCount) {
      const sorted = [...existingFrames].sort((a, b) =>
        (b.label ?? "").localeCompare(a.label ?? "", undefined, { numeric: true }),
      );
      const toRemove = sorted.slice(0, currentCount - config.units);
      for (const frame of toRemove) {
        await removeFrameIfAllowed(tx, frame);
      }
      existingFrames = existingFrames.filter((f) => !toRemove.some((r) => r.id === f.id));
    }

    if (config.units > 1) {
      await relabelFrames(tx, existingFrames, frameName, config.units);
    } else if (existingFrames.length === 1) {
      await tx.lampFrame.update({
        where: { id: existingFrames[0]!.id },
        data: { label: frameName },
      });
    }
  }

  const primary = frames[0]!;
  const totalUnits = frames.reduce((sum, f) => sum + f.units, 0);

  await tx.lamp.update({
    where: { id: lampId },
    data: {
      frameTypeId: primary.frameTypeId,
      surfaceM2: primary.surfaceM2,
      units: totalUnits,
    },
  });
}
