import {
  slotEndLabel,
  slotEndToHour,
  slotToHour,
  slotToLabel,
  rangeLabel,
} from "@/features/planning/engine/slot-format";
import type { GanttTimeAxisContext } from "@/features/planning/gantt-time-axis";
import { minuteToDayFraction } from "@/features/planning/gantt-time-axis";
import type { GanttPlanningAssignment } from "@/features/planning/queries";
import { getTaskLampFrameLabel } from "@/features/planning/task-lamp-frame";
import { toUtcDay } from "@/lib/week";

function toPlanningDayIso(d: Date): string {
  return toUtcDay(d).toISOString().slice(0, 10);
}

export interface GanttTimelineBlock {
  kind: "work" | "wait";
  startDayIso: string;
  startSlot: number;
  endDayIso: string;
  endSlot: number;
  /** Wall-clock minutes from midnight (Gantt horizontal position). */
  startMinutes: number;
  endMinutes: number;
  hours?: number;
  label: string;
}

export interface PlanningInstant {
  dayIso: string;
  slot: number;
  minutes: number;
}

function parsePlanningDay(iso: string): Date {
  return toUtcDay(new Date(`${iso}T00:00:00.000Z`));
}

export function slotToStartMinutes(slot: number): number {
  return Math.round(slotToHour(slot) * 60);
}

export function slotToEndMinutes(slot: number): number {
  return Math.round(slotEndToHour(slot) * 60);
}

function dateAtMinutes(dayIso: string, minutes: number): Date {
  const d = parsePlanningDay(dayIso);
  d.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function instantFromDate(d: Date, slotHint: number): PlanningInstant {
  return {
    dayIso: toPlanningDayIso(d),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    slot: slotHint,
  };
}

function compareByMinutes(a: PlanningInstant, b: PlanningInstant): number {
  const dayCmp = a.dayIso.localeCompare(b.dayIso);
  if (dayCmp !== 0) return dayCmp;
  return a.minutes - b.minutes;
}

/** Wall-clock wait from the end of a work block (calendar hours). */
export function addWallClockWait(
  endDayIso: string,
  endSlot: number,
  waitHours: number,
): PlanningInstant {
  const start = dateAtMinutes(endDayIso, slotToEndMinutes(endSlot));
  const end = new Date(start.getTime() + waitHours * 60 * 60 * 1000);
  return instantFromDate(end, endSlot);
}

export function dayIndex(axis: string[], iso: string): number {
  return axis.indexOf(iso);
}

/** Posición fraccional en el eje [0, axis.length] usando minutos reales y horario de nave. */
export function toAxisFraction(
  axis: string[],
  dayIso: string,
  minutes: number,
  timeAxis: GanttTimeAxisContext,
): number | null {
  const idx = dayIndex(axis, dayIso);
  if (idx < 0) return null;
  const bounds = timeAxis.boundsForDayIso(dayIso);
  const dayFrac = minuteToDayFraction(minutes, bounds);
  return idx + dayFrac;
}

export function resolveBlockRange(
  axis: string[],
  block: Pick<
    GanttTimelineBlock,
    "startDayIso" | "endDayIso" | "startMinutes" | "endMinutes"
  >,
  timeAxis: GanttTimeAxisContext,
): { startFrac: number; endFrac: number } | null {
  if (axis.length === 0) return null;

  const startFrac = toAxisFraction(
    axis,
    block.startDayIso,
    block.startMinutes,
    timeAxis,
  );
  const endFrac = toAxisFraction(
    axis,
    block.endDayIso,
    block.endMinutes,
    timeAxis,
  );

  if (startFrac == null || endFrac == null) return null;
  if (endFrac <= startFrac) return null;

  return {
    startFrac: Math.max(0, startFrac),
    endFrac: Math.min(axis.length, endFrac),
  };
}

function workBlockLabel(
  dayIso: string,
  startSlot: number,
  endSlot: number,
  hours: number,
): string {
  const day = formatShortDay(dayIso);
  return `${day} · ${rangeLabel(startSlot, endSlot)} · ${hours}h`;
}

function processWaitLabel(processCode: string, waitHours: number): string {
  return `Espera secado · ${processCode} (${waitHours}h)`;
}

function formatShortDay(iso: string): string {
  const d = parsePlanningDay(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function dryWaitAfterBlock(
  last: Pick<
    GanttTimelineBlock,
    "endDayIso" | "endSlot" | "endMinutes"
  >,
  waitHours: number,
  capBefore: PlanningInstant | null,
): Omit<GanttTimelineBlock, "kind" | "label" | "hours"> | null {
  const waitEnd = addWallClockWait(last.endDayIso, last.endSlot, waitHours);

  let endDayIso = waitEnd.dayIso;
  let endMinutes = waitEnd.minutes;
  let endSlot = last.endSlot;

  if (capBefore && compareByMinutes(waitEnd, capBefore) > 0) {
    endDayIso = capBefore.dayIso;
    endMinutes = capBefore.minutes;
    endSlot = capBefore.slot;
  }

  const startMinutes = last.endMinutes;
  const start: PlanningInstant = {
    dayIso: last.endDayIso,
    slot: last.endSlot,
    minutes: startMinutes,
  };
  const end: PlanningInstant = {
    dayIso: endDayIso,
    slot: endSlot,
    minutes: endMinutes,
  };

  if (compareByMinutes(end, start) <= 0) {
    return null;
  }

  return {
    startDayIso: last.endDayIso,
    startSlot: last.endSlot,
    startMinutes,
    endDayIso,
    endSlot,
    endMinutes,
  };
}

interface TimelineTaskRef {
  estimatedStart: string | null;
  estimatedEnd: string | null;
  startSlot: number | null;
  endSlot: number | null;
  timelineBlocks: GanttTimelineBlock[];
  process: string;
}

function taskExtentEnd(
  task: TimelineTaskRef,
  waitHoursByProcess: Map<string, number>,
): { endDayIso: string; endSlot: number; endMinutes: number } {
  const work = task.timelineBlocks.filter((b) => b.kind === "work");
  const lastWork = work[work.length - 1];
  if (!lastWork) {
    const endSlot = task.endSlot ?? 0;
    return {
      endDayIso: task.estimatedEnd!,
      endSlot,
      endMinutes: slotToEndMinutes(endSlot),
    };
  }

  const waitHours = waitHoursByProcess.get(task.process) ?? 0;
  if (waitHours > 1e-6) {
    const dry = dryWaitAfterBlock(lastWork, waitHours, null);
    if (dry) {
      return {
        endDayIso: dry.endDayIso,
        endSlot: dry.endSlot,
        endMinutes: dry.endMinutes,
      };
    }
  }

  return {
    endDayIso: lastWork.endDayIso,
    endSlot: lastWork.endSlot,
    endMinutes: lastWork.endMinutes,
  };
}

/** Una sola barra continua desde el inicio de la primera tarea hasta el fin de la última (incl. secado). */
export function buildContinuousTimeline(
  tasks: TimelineTaskRef[],
  waitHoursByProcess: Map<string, number>,
  holidayDates: Set<string>,
  labelPrefix: string,
): GanttTimelineBlock[] {
  void holidayDates;
  const assigned = tasks.filter((t) => t.estimatedStart && t.estimatedEnd);
  if (assigned.length === 0) return [];

  function taskStart(
    task: TimelineTaskRef,
  ): { startDayIso: string; startSlot: number; startMinutes: number } {
    const work = task.timelineBlocks.filter((b) => b.kind === "work");
    const firstWork = work[0];
    if (firstWork) {
      return {
        startDayIso: firstWork.startDayIso,
        startSlot: firstWork.startSlot,
        startMinutes: firstWork.startMinutes,
      };
    }
    const startSlot = task.startSlot ?? 0;
    return {
      startDayIso: task.estimatedStart!,
      startSlot,
      startMinutes: slotToStartMinutes(startSlot),
    };
  }

  const firstStart = taskStart(assigned[0]!);
  let startDayIso = firstStart.startDayIso;
  let startSlot = firstStart.startSlot;
  let startMinutes = firstStart.startMinutes;
  let endDayIso = assigned[0]!.estimatedEnd!;
  let endSlot = assigned[0]!.endSlot ?? 0;
  let endMinutes = slotToEndMinutes(endSlot);

  for (const t of assigned) {
    const tStart = taskStart(t);
    if (
      tStart.startDayIso < startDayIso ||
      (tStart.startDayIso === startDayIso && tStart.startMinutes < startMinutes)
    ) {
      startDayIso = tStart.startDayIso;
      startSlot = tStart.startSlot;
      startMinutes = tStart.startMinutes;
    }

    const extent = taskExtentEnd(t, waitHoursByProcess);
    if (
      extent.endDayIso > endDayIso ||
      (extent.endDayIso === endDayIso && extent.endMinutes > endMinutes)
    ) {
      endDayIso = extent.endDayIso;
      endSlot = extent.endSlot;
      endMinutes = extent.endMinutes;
    }
  }

  return [
    {
      kind: "work",
      startDayIso,
      startSlot,
      startMinutes,
      endDayIso,
      endSlot,
      endMinutes,
      label: `${labelPrefix} · ${formatShortDay(startDayIso)} ${slotToLabel(startSlot)} → ${formatShortDay(endDayIso)} ${slotEndLabel(endSlot)}`,
    },
  ];
}

export function buildTaskTimelineBlocks(
  assignments: GanttPlanningAssignment[],
  taskId: string,
  waitHours: number,
  holidayDates: Set<string>,
  processCode: string,
  capBefore: PlanningInstant | null = null,
): GanttTimelineBlock[] {
  void holidayDates;
  const forTask = assignments
    .filter((a) => a.taskId === taskId)
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
    );

  if (forTask.length === 0) return [];

  const frameLabel = getTaskLampFrameLabel(forTask[0]!.task);

  const work: GanttTimelineBlock[] = forTask.map((a) => {
    const dayIso = toPlanningDayIso(a.date);
    const startMinutes = slotToStartMinutes(a.startSlot);
    const endMinutes = slotToEndMinutes(a.endSlot);
    const workLabel = frameLabel
      ? `${workBlockLabel(dayIso, a.startSlot, a.endSlot, a.hours)} · Bastidor ${frameLabel}`
      : workBlockLabel(dayIso, a.startSlot, a.endSlot, a.hours);
    return {
      kind: "work" as const,
      startDayIso: dayIso,
      startSlot: a.startSlot,
      startMinutes,
      endDayIso: dayIso,
      endSlot: a.endSlot,
      endMinutes,
      hours: a.hours,
      label: workLabel,
    };
  });

  const blocks: GanttTimelineBlock[] = [...work];

  if (waitHours > 1e-6) {
    const last = work[work.length - 1]!;
    const dry = dryWaitAfterBlock(last, waitHours, capBefore);
    if (dry) {
      blocks.push({
        kind: "wait",
        ...dry,
        label: frameLabel
          ? `${processWaitLabel(processCode, waitHours)} · Bastidor ${frameLabel}`
          : processWaitLabel(processCode, waitHours),
      });
    }
  }

  return blocks;
}

export function timelineHoverSummary(blocks: GanttTimelineBlock[]): string {
  if (blocks.length === 0) return "";
  const work = blocks.filter((b) => b.kind === "work");
  if (work.length === 0) {
    return blocks.map((b) => b.label).join("\n");
  }

  const first = work[0]!;
  const lastWork = work[work.length - 1]!;
  const lines = [
    `Inicio: ${formatShortDay(first.startDayIso)} ${slotToLabel(first.startSlot)}`,
    `Fin: ${formatShortDay(lastWork.endDayIso)} ${slotEndLabel(lastWork.endSlot)}`,
  ];
  if (work.length > 1) {
    lines.push(`${work.length} fragmentos`);
  }
  const waits = blocks.filter((b) => b.kind === "wait");
  if (waits.length > 0) {
    lines.push(waits.map((w) => w.label).join("\n"));
  }
  return lines.join("\n");
}
