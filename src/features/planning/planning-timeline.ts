import type { ProcessCode } from "@/types/process";
import {
  slotEndLabel,
  slotToHour,
  slotToLabel,
} from "@/features/planning/engine/slot-format";
import { addWallClockWait } from "@/features/planning/gantt-timeline";
import { formatHours, formatShortDate } from "@/lib/format";
import { taskChainKey } from "@/features/planning/task-chain-key";
import { toUtcDay } from "@/lib/week";

/** Slice mínimo de asignación para construir la línea de tiempo. */
export interface PlanningAssignmentSlice {
  id: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: ProcessCode;
  personId: string;
  person: {
    id: string;
    iniciales: string;
    color: string;
    alias: string | null;
    nombre: string;
  };
  task: {
    id: string;
    order: number;
    isCompleted: boolean;
    projectId: string;
    lampId: string;
    lampElementId?: string | null;
    lamp: { name: string | null; elementType?: { name: string } | null } | null;
    lampElement?: { label: string | null; elementType?: { name: string } | null } | null;
    project: { name: string };
    workOrder?: { number: string; status: import("@/generated/prisma").WorkOrderStatus } | null;
  };
}

export interface ProcessWaitInfo {
  waitHours: number;
}

/** Tarea en la cadena productiva de una lámpara (orden completo, con o sin asignación). */
export interface LampTaskChainItem {
  id: string;
  lampId: string;
  lampElementId?: string | null;
  order: number;
  process: ProcessCode;
}

export interface DryWaitTimelineItem {
  kind: "dry-wait";
  id: string;
  lampId: string;
  lampName: string | null;
  afterProcess: ProcessCode;
  waitHours: number;
  date: Date;
  scheduleLabel: string;
}

export interface WorkTimelineItem {
  kind: "work";
  assignment: PlanningAssignmentSlice;
}

export type PlanningTimelineItem = WorkTimelineItem | DryWaitTimelineItem;

function timelineSortKey(item: PlanningTimelineItem): string {
  return item.kind === "work" ? item.assignment.id : item.id;
}

function compareAssignments(a: PlanningAssignmentSlice, b: PlanningAssignmentSlice): number {
  return (
    a.date.getTime() - b.date.getTime() ||
    a.startSlot - b.startSlot ||
    a.endSlot - b.endSlot
  );
}

function lastSlice(slices: PlanningAssignmentSlice[]): PlanningAssignmentSlice {
  return slices.reduce((best, s) =>
    compareAssignments(s, best) > 0 ? s : best,
  );
}

function firstSlice(slices: PlanningAssignmentSlice[]): PlanningAssignmentSlice {
  return slices.reduce((best, s) =>
    compareAssignments(s, best) < 0 ? s : best,
  );
}

function toPlanningDayIso(d: Date): string {
  return toUtcDay(d).toISOString().slice(0, 10);
}

function formatWallClockMinutes(minutes: number): string {
  return formatHours(minutes / 60);
}

function formatDryWaitWindow(
  from: PlanningAssignmentSlice,
  waitHours: number,
): string {
  const fromDayIso = toPlanningDayIso(from.date);
  const unlock = addWallClockWait(fromDayIso, from.endSlot, waitHours);
  const unlockTime = formatWallClockMinutes(unlock.minutes);
  if (unlock.dayIso === fromDayIso) {
    return `${slotEndLabel(from.endSlot)} → ${unlockTime}`;
  }
  return `${slotEndLabel(from.endSlot)} → ${formatShortDate(unlock.dayIso)} ${unlockTime}`;
}

function scheduledStartLabel(
  to: PlanningAssignmentSlice,
  unlockDayIso: string,
): string {
  const succDayIso = toPlanningDayIso(to.date);
  if (succDayIso === unlockDayIso) {
    return slotToLabel(to.startSlot);
  }
  return `${formatShortDate(to.date)} ${slotToLabel(to.startSlot)}`;
}

function successorStartsAfterDryWindow(
  unlock: ReturnType<typeof addWallClockWait>,
  to: PlanningAssignmentSlice,
): boolean {
  const succDayIso = toPlanningDayIso(to.date);
  const succMinutes = Math.round(slotToHour(to.startSlot) * 60);
  return (
    succDayIso > unlock.dayIso ||
    (succDayIso === unlock.dayIso && succMinutes > unlock.minutes)
  );
}

function scheduleGapLabel(
  from: PlanningAssignmentSlice,
  to: PlanningAssignmentSlice | null,
  waitHours: number,
): string {
  if (!to) {
    return `${slotEndLabel(from.endSlot)} · mín. ${waitHours}h`;
  }

  const fromDayIso = toPlanningDayIso(from.date);
  const unlock = addWallClockWait(fromDayIso, from.endSlot, waitHours);
  const windowLabel = formatDryWaitWindow(from, waitHours);

  if (successorStartsAfterDryWindow(unlock, to)) {
    return `${windowLabel} · ${to.process} planificada ${scheduledStartLabel(to, unlock.dayIso)}`;
  }

  return windowLabel;
}

/**
 * Inserta pseudotareas de secado entre procesos consecutivos del mismo elemento.
 * Usa el waitHours del proceso anterior (igual que el solver CP-SAT).
 */
export function buildPlanningTimeline(
  assignments: PlanningAssignmentSlice[],
  processByCode: Map<ProcessCode, ProcessWaitInfo>,
  lampTaskChains?: LampTaskChainItem[],
): PlanningTimelineItem[] {
  const byTask = new Map<string, PlanningAssignmentSlice[]>();

  for (const a of assignments) {
    const list = byTask.get(a.task.id) ?? [];
    list.push(a);
    byTask.set(a.task.id, list);
  }

  const chainsByKey = new Map<string, LampTaskChainItem[]>();
  if (lampTaskChains) {
    for (const item of lampTaskChains) {
      const key = taskChainKey({
        lampId: item.lampId,
        lampElementId: item.lampElementId,
      });
      const list = chainsByKey.get(key) ?? [];
      list.push(item);
      chainsByKey.set(key, list);
    }
    for (const list of chainsByKey.values()) {
      list.sort(
        (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
      );
    }
  } else {
    const fallbackChains = new Map<string, LampTaskChainItem[]>();
    for (const slices of byTask.values()) {
      const sample = slices[0];
      if (!sample) continue;
      const key = taskChainKey(sample.task);
      const list = fallbackChains.get(key) ?? [];
      list.push({
        id: sample.task.id,
        lampId: sample.task.lampId,
        lampElementId: sample.task.lampElementId,
        order: sample.task.order,
        process: sample.process,
      });
      fallbackChains.set(key, list);
    }
    for (const [key, list] of fallbackChains) {
      list.sort(
        (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
      );
      chainsByKey.set(key, list);
    }
  }

  const dryWaits: DryWaitTimelineItem[] = [];

  for (const chain of chainsByKey.values()) {
    const lampId = chain[0]?.lampId ?? "";
    const lampName =
      [...byTask.values()]
        .map((slices) => slices[0]?.task.lamp?.name ?? null)
        .find((name) => name != null) ?? null;

    for (let i = 0; i < chain.length - 1; i++) {
      const pred = chain[i]!;
      const succ = chain[i + 1]!;

      const proc = processByCode.get(pred.process);
      const waitHours = proc?.waitHours ?? 0;
      if (waitHours <= 0) continue;

      const predSlices = byTask.get(pred.id) ?? [];
      if (predSlices.length === 0) continue;

      const succSlices = byTask.get(succ.id) ?? [];
      const predEnd = lastSlice(predSlices);
      const succStart = succSlices.length > 0 ? firstSlice(succSlices) : null;

      dryWaits.push({
        kind: "dry-wait",
        id: `dry-${lampId}-${pred.id}-${succ.id}`,
        lampId,
        lampName,
        afterProcess: pred.process,
        waitHours,
        date: predEnd.date,
        scheduleLabel: scheduleGapLabel(predEnd, succStart, waitHours),
      });
    }
  }

  const work: WorkTimelineItem[] = assignments.map((assignment) => ({
    kind: "work",
    assignment,
  }));

  const merged: PlanningTimelineItem[] = [...work, ...dryWaits];
  merged.sort((a, b) => {
    const aDate = a.kind === "work" ? a.assignment.date : a.date;
    const bDate = b.kind === "work" ? b.assignment.date : b.date;
    const d = aDate.getTime() - bDate.getTime();
    if (d !== 0) return d;
    if (a.kind === "work" && b.kind === "work") {
      return compareAssignments(a.assignment, b.assignment);
    }
    if (a.kind === "dry-wait" && b.kind === "work") {
      return a.scheduleLabel.localeCompare(slotToLabel(b.assignment.startSlot));
    }
    if (a.kind === "work" && b.kind === "dry-wait") {
      return slotToLabel(a.assignment.startSlot).localeCompare(b.scheduleLabel);
    }
    return timelineSortKey(a).localeCompare(timelineSortKey(b));
  });

  return merged;
}

/** Secados visibles si el operario tiene trabajo en esa lámpara la misma semana. */
export function filterTimelineForPerson(
  items: PlanningTimelineItem[],
  personId: string,
): PlanningTimelineItem[] {
  const lampsForPerson = new Set(
    items
      .filter((i) => i.kind === "work" && i.assignment.personId === personId)
      .map((i) => (i.kind === "work" ? i.assignment.task.lampId : "")),
  );

  return items.filter((item) => {
    if (item.kind === "work") {
      return item.assignment.personId === personId;
    }
    return lampsForPerson.has(item.lampId);
  });
}
