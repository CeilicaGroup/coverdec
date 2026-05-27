import type { ProcessCode } from "@/types/process";
import { slotEndLabel, slotToLabel } from "@/features/planning/engine/slot-format";
import { formatShortDate } from "@/lib/format";

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
    lamp: { name: string | null } | null;
    project: { name: string };
  };
}

export interface ProcessWaitInfo {
  waitHours: number;
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

function scheduleGapLabel(
  from: PlanningAssignmentSlice,
  to: PlanningAssignmentSlice | null,
  waitHours: number,
): string {
  if (to) {
    const sameDay =
      from.date.toISOString().slice(0, 10) === to.date.toISOString().slice(0, 10);
    if (sameDay) {
      return `${slotEndLabel(from.endSlot)}–${slotToLabel(to.startSlot)}`;
    }
    return `${slotEndLabel(from.endSlot)} → ${formatShortDate(to.date)} ${slotToLabel(to.startSlot)}`;
  }
  return `${slotEndLabel(from.endSlot)} · mín. ${waitHours}h`;
}

/**
 * Inserta pseudotareas de secado entre procesos consecutivos de la misma lámpara.
 * Usa el waitHours del proceso anterior (igual que el solver CP-SAT).
 */
export function buildPlanningTimeline(
  assignments: PlanningAssignmentSlice[],
  processByCode: Map<ProcessCode, ProcessWaitInfo>,
): PlanningTimelineItem[] {
  const byLamp = new Map<string, Map<string, PlanningAssignmentSlice[]>>();

  for (const a of assignments) {
    const lampId = a.task.lampId;
    const byTask = byLamp.get(lampId) ?? new Map();
    const list = byTask.get(a.task.id) ?? [];
    list.push(a);
    byTask.set(a.task.id, list);
    byLamp.set(lampId, byTask);
  }

  const dryWaits: DryWaitTimelineItem[] = [];

  for (const [lampId, byTask] of byLamp) {
    const taskMeta = new Map<string, { order: number; process: ProcessCode; lampName: string | null }>();
    for (const slices of byTask.values()) {
      const sample = slices[0];
      if (!sample) continue;
      taskMeta.set(sample.task.id, {
        order: sample.task.order,
        process: sample.process,
        lampName: sample.task.lamp?.name ?? null,
      });
    }

    const orderedTaskIds = [...taskMeta.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);

    for (let i = 0; i < orderedTaskIds.length - 1; i++) {
      const predId = orderedTaskIds[i]!;
      const succId = orderedTaskIds[i + 1]!;
      const predMeta = taskMeta.get(predId)!;
      const proc = processByCode.get(predMeta.process);
      const waitHours = proc?.waitHours ?? 0;
      if (waitHours <= 0) continue;

      const predSlices = byTask.get(predId) ?? [];
      if (predSlices.length === 0) continue;

      const succSlices = byTask.get(succId) ?? [];
      const predEnd = lastSlice(predSlices);
      const succStart = succSlices.length > 0 ? firstSlice(succSlices) : null;

      dryWaits.push({
        kind: "dry-wait",
        id: `dry-${lampId}-${predId}-${succId}`,
        lampId,
        lampName: predMeta.lampName,
        afterProcess: predMeta.process,
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
