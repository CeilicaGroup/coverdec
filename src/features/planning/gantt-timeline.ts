import {
  PRODUCTIVE_SLOTS_PER_DAY,
  slotEndLabel,
  slotToLabel,
  rangeLabel,
} from "@/features/planning/engine/slot-format";
import type { GanttPlanningAssignment } from "@/features/planning/queries";
import { toUtcDay } from "@/lib/week";

function toPlanningDayIso(d: Date): string {
  return toUtcDay(d).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_EPS = 1e-6;

export interface GanttTimelineBlock {
  kind: "work" | "wait";
  startDayIso: string;
  startSlot: number;
  endDayIso: string;
  endSlot: number;
  hours?: number;
  label: string;
}

export interface PlanningInstant {
  dayIso: string;
  slot: number;
}

function parsePlanningDay(iso: string): Date {
  return toUtcDay(new Date(`${iso}T00:00:00.000Z`));
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function nextBusinessDayIso(iso: string, holidayDates: Set<string>): string {
  let cursor = new Date(parsePlanningDay(iso).getTime() + DAY_MS);
  while (isWeekend(cursor) || holidayDates.has(toPlanningDayIso(cursor))) {
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return toPlanningDayIso(cursor);
}

function comparePlanningInstant(a: PlanningInstant, b: PlanningInstant): number {
  if (a.dayIso !== b.dayIso) return a.dayIso.localeCompare(b.dayIso);
  return a.slot - b.slot;
}

/** Advance wait time on the productive slot axis (8h/day, skips weekends/holidays). */
export function addProductiveWait(
  startDayIso: string,
  startSlot: number,
  waitHours: number,
  holidayDates: Set<string>,
): PlanningInstant {
  let dayIso = startDayIso;
  let slot = Math.max(0, Math.min(PRODUCTIVE_SLOTS_PER_DAY, startSlot));
  let remainingQuarters = Math.max(0, Math.round(waitHours * 4));

  while (remainingQuarters > 0) {
    const slotsLeftToday = PRODUCTIVE_SLOTS_PER_DAY - slot;
    const use = Math.min(remainingQuarters, slotsLeftToday);
    remainingQuarters -= use;
    slot += use;
    if (remainingQuarters > 0) {
      dayIso = nextBusinessDayIso(dayIso, holidayDates);
      slot = 0;
    }
  }

  return { dayIso, slot };
}

export function dayIndex(axis: string[], iso: string): number {
  return axis.indexOf(iso);
}

/** Posición fraccional en el eje [0, axis.length] para un instante de planning. */
export function toAxisFraction(
  axis: string[],
  dayIso: string,
  slot: number,
): number | null {
  const idx = dayIndex(axis, dayIso);
  if (idx < 0) return null;
  const clamped = Math.max(0, Math.min(PRODUCTIVE_SLOTS_PER_DAY, slot));
  const dayFrac = clamped / PRODUCTIVE_SLOTS_PER_DAY;
  return idx + dayFrac;
}

export function resolveBlockRange(
  axis: string[],
  block: Pick<
    GanttTimelineBlock,
    "startDayIso" | "startSlot" | "endDayIso" | "endSlot"
  >,
): { startFrac: number; endFrac: number } | null {
  if (axis.length === 0) return null;

  const startFrac = toAxisFraction(axis, block.startDayIso, block.startSlot);
  const endFrac = toAxisFraction(axis, block.endDayIso, block.endSlot);

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
  last: Pick<GanttTimelineBlock, "endDayIso" | "endSlot">,
  waitHours: number,
  holidayDates: Set<string>,
  capBefore: PlanningInstant | null,
): Omit<GanttTimelineBlock, "kind" | "label" | "hours"> | null {
  const waitEnd = addProductiveWait(
    last.endDayIso,
    last.endSlot,
    waitHours,
    holidayDates,
  );

  let endDayIso = waitEnd.dayIso;
  let endSlot = waitEnd.slot;

  if (
    capBefore &&
    comparePlanningInstant({ dayIso: endDayIso, slot: endSlot }, capBefore) > 0
  ) {
    endDayIso = capBefore.dayIso;
    endSlot = capBefore.slot;
  }

  const start: PlanningInstant = {
    dayIso: last.endDayIso,
    slot: last.endSlot,
  };
  const end: PlanningInstant = { dayIso: endDayIso, slot: endSlot };

  if (comparePlanningInstant(end, start) <= 0) {
    return null;
  }

  return {
    startDayIso: last.endDayIso,
    startSlot: last.endSlot,
    endDayIso,
    endSlot,
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
  holidayDates: Set<string>,
): { endDayIso: string; endSlot: number } {
  const work = task.timelineBlocks.filter((b) => b.kind === "work");
  const lastWork = work[work.length - 1];
  if (!lastWork) {
    return {
      endDayIso: task.estimatedEnd!,
      endSlot: task.endSlot ?? 0,
    };
  }

  const waitHours = waitHoursByProcess.get(task.process) ?? 0;
  if (waitHours > 1e-6) {
    const dry = dryWaitAfterBlock(lastWork, waitHours, holidayDates, null);
    if (dry) {
      return { endDayIso: dry.endDayIso, endSlot: dry.endSlot };
    }
  }

  return { endDayIso: lastWork.endDayIso, endSlot: lastWork.endSlot };
}

/** Una sola barra continua desde el inicio de la primera tarea hasta el fin de la última (incl. secado). */
export function buildContinuousTimeline(
  tasks: TimelineTaskRef[],
  waitHoursByProcess: Map<string, number>,
  holidayDates: Set<string>,
  labelPrefix: string,
): GanttTimelineBlock[] {
  const assigned = tasks.filter((t) => t.estimatedStart && t.estimatedEnd);
  if (assigned.length === 0) return [];

  function taskStart(
    task: TimelineTaskRef,
  ): { startDayIso: string; startSlot: number } {
    const work = task.timelineBlocks.filter((b) => b.kind === "work");
    const firstWork = work[0];
    if (firstWork) {
      return { startDayIso: firstWork.startDayIso, startSlot: firstWork.startSlot };
    }
    return { startDayIso: task.estimatedStart!, startSlot: task.startSlot ?? 0 };
  }

  const firstStart = taskStart(assigned[0]!);
  let startDayIso = firstStart.startDayIso;
  let startSlot = firstStart.startSlot;
  let endDayIso = assigned[0]!.estimatedEnd!;
  let endSlot = assigned[0]!.endSlot ?? 0;

  for (const t of assigned) {
    const tStart = taskStart(t);
    if (
      tStart.startDayIso < startDayIso ||
      (tStart.startDayIso === startDayIso && tStart.startSlot < startSlot)
    ) {
      startDayIso = tStart.startDayIso;
      startSlot = tStart.startSlot;
    }

    const extent = taskExtentEnd(t, waitHoursByProcess, holidayDates);
    if (
      extent.endDayIso > endDayIso ||
      (extent.endDayIso === endDayIso && extent.endSlot > endSlot)
    ) {
      endDayIso = extent.endDayIso;
      endSlot = extent.endSlot;
    }
  }

  return [
    {
      kind: "work",
      startDayIso,
      startSlot,
      endDayIso,
      endSlot,
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
  const forTask = assignments
    .filter((a) => a.taskId === taskId)
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
    );

  if (forTask.length === 0) return [];

  const frameLabel =
    forTask[0]!.task.lampFrame?.label ??
    forTask[0]!.task.lampFrame?.frameType?.name ??
    forTask[0]!.task.lamp.frameType?.name ??
    null;

  const work: GanttTimelineBlock[] = forTask.map((a) => {
    const dayIso = toPlanningDayIso(a.date);
    const workLabel = frameLabel
      ? `${workBlockLabel(dayIso, a.startSlot, a.endSlot, a.hours)} · Bastidor ${frameLabel}`
      : workBlockLabel(dayIso, a.startSlot, a.endSlot, a.hours);
    return {
      kind: "work" as const,
      startDayIso: dayIso,
      startSlot: a.startSlot,
      endDayIso: dayIso,
      endSlot: a.endSlot,
      hours: a.hours,
      label: workLabel,
    };
  });

  const blocks: GanttTimelineBlock[] = [...work];

  if (waitHours > 1e-6) {
    const last = work[work.length - 1]!;
    const dry = dryWaitAfterBlock(last, waitHours, holidayDates, capBefore);
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
