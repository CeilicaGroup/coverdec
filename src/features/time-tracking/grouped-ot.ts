export interface GroupedOtMeasureTask {
  lamp: {
    surfaceM2: number | null;
    units: number;
  } | null;
  lampElement: {
    surfaceM2: number | null;
    units: number;
  } | null;
}

export interface GroupedOtTimeRange {
  startedAt: Date;
  endedAt: Date;
}

export interface GroupedOtEntrySegment {
  startedAt: Date;
  endedAt: Date;
  hours: number;
}

export function taskMeasureForGroupedOt(task: GroupedOtMeasureTask): number {
  const lampElementMeasure =
    task.lampElement?.surfaceM2 && task.lampElement.surfaceM2 > 0
      ? task.lampElement.surfaceM2 * Math.max(1, task.lampElement.units)
      : null;
  if (lampElementMeasure && lampElementMeasure > 0) return lampElementMeasure;

  const lampMeasure =
    task.lamp?.surfaceM2 && task.lamp.surfaceM2 > 0
      ? task.lamp.surfaceM2 * Math.max(1, task.lamp.units)
      : null;
  if (lampMeasure && lampMeasure > 0) return lampMeasure;

  return 1;
}

export function distributeHoursByMeasure(
  totalHours: number,
  tasks: GroupedOtMeasureTask[],
): number[] {
  const measures = tasks.map(taskMeasureForGroupedOt);
  const sumMeasures = measures.reduce((sum, value) => sum + value, 0);
  if (sumMeasures <= 0) {
    const evenHours = totalHours / tasks.length;
    return tasks.map((_, index) =>
      index === tasks.length - 1 ? totalHours - evenHours * index : evenHours,
    );
  }

  const precision = 6;
  const rounded = measures.map((measure) =>
    Number(((totalHours * measure) / sumMeasures).toFixed(precision)),
  );
  const assignedBeforeLast = rounded.slice(0, -1).reduce((sum, value) => sum + value, 0);
  rounded[rounded.length - 1] = Number((totalHours - assignedBeforeLast).toFixed(precision));
  return rounded;
}

export function splitRangesByTaskHours(
  ranges: GroupedOtTimeRange[],
  taskHours: number[],
): GroupedOtEntrySegment[][] {
  const cursor = ranges.map((range) => ({
    currentMs: range.startedAt.getTime(),
    endMs: range.endedAt.getTime(),
  }));
  const allocations: GroupedOtEntrySegment[][] = taskHours.map(() => []);
  const epsilonMs = 1;
  let rangeIndex = 0;

  for (let taskIndex = 0; taskIndex < taskHours.length; taskIndex += 1) {
    let remainingMs = Math.max(0, taskHours[taskIndex] * 3600000);
    while (remainingMs > epsilonMs) {
      while (rangeIndex < cursor.length && cursor[rangeIndex].currentMs >= cursor[rangeIndex].endMs) {
        rangeIndex += 1;
      }
      if (rangeIndex >= cursor.length) {
        throw new Error("No hay suficiente rango de tiempo para repartir las horas seleccionadas.");
      }

      const range = cursor[rangeIndex];
      const availableMs = range.endMs - range.currentMs;
      const chunkMs = Math.min(availableMs, remainingMs);
      const startedAt = new Date(range.currentMs);
      const endedAt = new Date(range.currentMs + chunkMs);
      allocations[taskIndex].push({
        startedAt,
        endedAt,
        hours: chunkMs / 3600000,
      });
      range.currentMs += chunkMs;
      remainingMs -= chunkMs;
    }
  }

  return allocations;
}
