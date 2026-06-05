import { prisma } from "@/lib/db";
import { resolveTimeEntryHours } from "@/features/time-tracking/entry-hours";

export interface CatalogTimeDeviationRow {
  elementTypeId: string;
  frameTypeCode: string;
  frameTypeName: string;
  process: string;
  catalogHoursPerUnit: number;
  observedHoursPerUnit: number | null;
  deviationPct: number | null;
  /** Muestras usadas en la media (últimas N). */
  sampleCount: number;
  /** Tareas completadas válidas en total (histórico). */
  totalSamples: number;
  movingAverageSamples: number;
  isAlert: boolean;
}

export interface TimeDeviationPolicyValues {
  deviationThresholdPct: number;
  movingAverageSamples: number;
}

interface TaskRateSample {
  rate: number;
  completedAt: Date;
}

const POLICY_ID = "singleton";

export async function getTimeDeviationPolicy(): Promise<TimeDeviationPolicyValues> {
  const row = await prisma.timeDeviationPolicy.findUnique({
    where: { id: POLICY_ID },
  });
  return {
    deviationThresholdPct: row?.deviationThresholdPct ?? 15,
    movingAverageSamples: row?.movingAverageSamples ?? 10,
  };
}

/** Última finalización de partes en la tarea (referencia temporal de la muestra). */
export function taskSampleCompletedAt(
  entries: Array<{ endedAt: Date | null }>,
  fallback: Date,
): Date {
  let latest = fallback.getTime();
  for (const entry of entries) {
    if (entry.endedAt && entry.endedAt.getTime() > latest) {
      latest = entry.endedAt.getTime();
    }
  }
  return new Date(latest);
}

/** Media móvil: últimas `window` muestras ordenadas por fecha de cierre descendente. */
export function movingAverageFromSamples(
  samples: TaskRateSample[],
  window: number,
): { rates: number[]; usedCount: number; totalCount: number } {
  const totalCount = samples.length;
  if (totalCount === 0 || window <= 0) {
    return { rates: [], usedCount: 0, totalCount };
  }
  const sorted = [...samples].sort(
    (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
  );
  const windowed = sorted.slice(0, window);
  return {
    rates: windowed.map((s) => s.rate),
    usedCount: windowed.length,
    totalCount,
  };
}

export function computeDeviationPct(
  catalogHoursPerUnit: number,
  observedHoursPerUnit: number,
): number | null {
  if (catalogHoursPerUnit <= 1e-6) return null;
  return (Math.abs(observedHoursPerUnit - catalogHoursPerUnit) / catalogHoursPerUnit) * 100;
}

function observedPerUnitFromTask(args: {
  doneHours: number;
  fixedHours: number;
  surfaceM2: number;
}): number | null {
  if (args.surfaceM2 <= 1e-6) return null;
  return Math.max(0, (args.doneHours - args.fixedHours) / args.surfaceM2);
}

export async function computeCatalogDeviationForPair(args: {
  elementTypeId: string;
  process: string;
  policy?: TimeDeviationPolicyValues;
}): Promise<CatalogTimeDeviationRow | null> {
  const policy = args.policy ?? (await getTimeDeviationPolicy());

  const frameProcess = await prisma.elementTypeProcess.findUnique({
    where: {
      elementTypeId_process: {
        elementTypeId: args.elementTypeId,
        process: args.process,
      },
    },
    include: {
      elementType: { select: { id: true, code: true, name: true } },
    },
  });
  if (!frameProcess) return null;

  const completedTasks = await prisma.task.findMany({
    where: {
      isCompleted: true,
      process: args.process,
      OR: [
        { lamp: { elementTypeId: args.elementTypeId } },
        { lampElement: { elementTypeId: args.elementTypeId } },
      ],
    },
    select: {
      updatedAt: true,
      lamp: { select: { surfaceM2: true, elementTypeId: true } },
      lampElement: { select: { surfaceM2: true, elementTypeId: true } },
      timeEntries: {
        where: { endedAt: { not: null }, hours: { gt: 0 } },
        select: { startedAt: true, endedAt: true, hours: true },
      },
    },
  });

  const allSamples: TaskRateSample[] = [];
  for (const task of completedTasks) {
    const surfaceM2 = task.lampElement?.surfaceM2 ?? task.lamp.surfaceM2;
    if (surfaceM2 == null || surfaceM2 <= 1e-6) continue;
    const doneHours = task.timeEntries.reduce(
      (sum, e) => sum + resolveTimeEntryHours(e),
      0,
    );
    if (doneHours <= 1e-6) continue;
    const rate = observedPerUnitFromTask({
      doneHours,
      fixedHours: frameProcess.fixedHours,
      surfaceM2,
    });
    if (rate == null) continue;
    allSamples.push({
      rate,
      completedAt: taskSampleCompletedAt(task.timeEntries, task.updatedAt),
    });
  }

  const { rates, usedCount, totalCount } = movingAverageFromSamples(
    allSamples,
    policy.movingAverageSamples,
  );
  const sampleCount = usedCount;
  const observedHoursPerUnit =
    sampleCount > 0 ? rates.reduce((a, b) => a + b, 0) / sampleCount : null;
  const deviationPct =
    observedHoursPerUnit != null
      ? computeDeviationPct(frameProcess.hoursPerUnit, observedHoursPerUnit)
      : null;
  const isAlert =
    sampleCount >= policy.movingAverageSamples &&
    deviationPct != null &&
    deviationPct >= policy.deviationThresholdPct;

  return {
    elementTypeId: frameProcess.elementTypeId,
    // Históricamente se llamaba "frameType"; tras PR-04 el join es "elementType".
    frameTypeCode: frameProcess.elementType.code,
    frameTypeName: frameProcess.elementType.name,
    process: frameProcess.process,
    catalogHoursPerUnit: frameProcess.hoursPerUnit,
    observedHoursPerUnit,
    deviationPct,
    sampleCount,
    totalSamples: totalCount,
    movingAverageSamples: policy.movingAverageSamples,
    isAlert,
  };
}

export async function listCatalogTimeDeviations(): Promise<{
  policy: TimeDeviationPolicyValues;
  rows: CatalogTimeDeviationRow[];
  alertCount: number;
}> {
  const policy = await getTimeDeviationPolicy();
  const frameProcesses = await prisma.elementTypeProcess.findMany({
    where: { elementType: { isActive: true } },
    select: { elementTypeId: true, process: true },
    orderBy: [{ elementType: { code: "asc" } }, { sequence: "asc" }],
  });

  const rows: CatalogTimeDeviationRow[] = [];
  for (const fp of frameProcesses) {
    const row = await computeCatalogDeviationForPair({
      elementTypeId: fp.elementTypeId,
      process: fp.process,
      policy,
    });
    if (row) rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.isAlert !== b.isAlert) return a.isAlert ? -1 : 1;
    return (b.deviationPct ?? 0) - (a.deviationPct ?? 0);
  });

  return {
    policy,
    rows,
    alertCount: rows.filter((r) => r.isAlert).length,
  };
}

export async function resolveElementTypeProcessFromTaskId(
  taskId: string,
): Promise<{ elementTypeId: string; process: string } | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      process: true,
      lamp: { select: { elementTypeId: true } },
      lampElement: { select: { elementTypeId: true } },
    },
  });
  if (!task) return null;
  const elementTypeId = task.lampElement?.elementTypeId ?? task.lamp.elementTypeId;
  return { elementTypeId, process: task.process };
}
