import { prisma } from "@/lib/db";
import { slotEndToHour } from "@/features/planning/engine/slot-format";
import { minuteToWeekQuarter } from "@/features/planning/plan-from";
import { getMondayOf, toUtcDay } from "@/lib/week";

function toPlanningDayIso(d: Date): string {
  return toUtcDay(d).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;
import {
  PLANNING_HORIZON_DAYS,
  PLANNING_HORIZON_QUARTERS,
} from "@/features/planning/week-progress";

const QUARTERS_PER_DAY = 24 * 4;
const HORIZON_Q = PLANNING_HORIZON_QUARTERS;

export interface PriorPlanningAssignment {
  taskId: string;
  date: Date;
  endSlot: number;
  hours: number;
}

export interface PriorPlanningAssignmentDetail extends PriorPlanningAssignment {
  personId: string;
  person: {
    id: string;
    iniciales: string;
    nombre: string;
    color: string;
  };
}

export function buildPriorPlannedHoursByTaskId(
  assignments: Pick<PriorPlanningAssignment, "taskId" | "hours">[],
): Map<string, number> {
  const byTask = new Map<string, number>();
  for (const a of assignments) {
    byTask.set(a.taskId, (byTask.get(a.taskId) ?? 0) + a.hours);
  }
  return byTask;
}

export function buildPriorPlannedHoursByProjectId(
  projects: { id: string; tasks: { id: string }[] }[],
  priorPlannedHoursByTask: Map<string, number>,
): Map<string, number> {
  const byProject = new Map<string, number>();
  for (const p of projects) {
    let sum = 0;
    for (const t of p.tasks) {
      sum += priorPlannedHoursByTask.get(t.id) ?? 0;
    }
    if (sum > 0) byProject.set(p.id, sum);
  }
  return byProject;
}

interface LampTaskRef {
  id: string;
  lampId: string;
  order: number;
  process: string;
  pendingHours: number;
  doneHours: number;
  estimatedHours: number;
}

function taskHasNoPendingWork(task: LampTaskRef): boolean {
  if (task.pendingHours <= 0) return true;
  if (
    task.estimatedHours > 0 &&
    task.doneHours >= task.estimatedHours - 1e-6
  ) {
    return true;
  }
  return Math.max(0, task.estimatedHours - task.doneHours) <= 0;
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function nextBusinessDayIso(iso: string, holidayDates: Set<string>): string {
  let cursor = new Date(`${iso}T00:00:00.000Z`);
  cursor = new Date(cursor.getTime() + DAY_MS);
  while (isWeekend(cursor) || holidayDates.has(toPlanningDayIso(cursor))) {
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return toPlanningDayIso(cursor);
}

function assignmentEndDateTime(date: Date, endSlot: number): Date {
  const hour = slotEndToHour(endSlot);
  const d = toUtcDay(date);
  d.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d;
}

function addWaitHours(end: Date, waitHours: number): Date {
  if (waitHours <= 0) return end;
  return new Date(end.getTime() + waitHours * 60 * 60 * 1000);
}

function advanceToBusinessDay(dt: Date, holidayDates: Set<string>): Date {
  let d = new Date(dt);
  while (isWeekend(d) || holidayDates.has(toPlanningDayIso(d))) {
    d = new Date(d.getTime() + DAY_MS);
    d.setUTCHours(8, 0, 0, 0);
  }
  return d;
}

export function buildLastAssignmentEndByTaskId(
  assignments: PriorPlanningAssignment[],
): Map<string, { date: Date; endSlot: number }> {
  const byTask = new Map<string, { date: Date; endSlot: number }>();
  for (const a of assignments) {
    const day = toUtcDay(a.date);
    const cur = byTask.get(a.taskId);
    if (!cur) {
      byTask.set(a.taskId, { date: day, endSlot: a.endSlot });
      continue;
    }
    if (day.getTime() > cur.date.getTime()) {
      byTask.set(a.taskId, { date: day, endSlot: a.endSlot });
    } else if (
      day.getTime() === cur.date.getTime() &&
      a.endSlot > cur.endSlot
    ) {
      byTask.set(a.taskId, { date: day, endSlot: a.endSlot });
    }
  }
  return byTask;
}

export function dateTimeToWeekQuarter(weekStart: Date, dt: Date): number {
  const monday = toUtcDay(weekStart);
  const day = toUtcDay(dt);
  const dayIdx = Math.floor((day.getTime() - monday.getTime()) / DAY_MS);
  if (dayIdx < 0) return 0;
  if (dayIdx >= PLANNING_HORIZON_DAYS) return HORIZON_Q;
  const minuteOfDay = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  return minuteToWeekQuarter(dayIdx, minuteOfDay);
}

export function computeMinWeekQuarterByTaskId(args: {
  weekStart: Date;
  tasks: LampTaskRef[];
  engineTaskIds: Set<string>;
  priorEnds: Map<string, { date: Date; endSlot: number }>;
  waitHoursByProcess: Map<string, number>;
  holidayDates: Set<string>;
}): {
  minByTask: Map<string, number>;
  deferredPastHorizon: Set<string>;
} {
  const deferredPastHorizon = new Set<string>();
  const byLamp = new Map<string, LampTaskRef[]>();
  for (const t of args.tasks) {
    const list = byLamp.get(t.lampId) ?? [];
    list.push(t);
    byLamp.set(t.lampId, list);
  }

  const minByTask = new Map<string, number>();

  for (const group of byLamp.values()) {
    const sorted = [...group].sort(
      (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
    );

    for (const task of sorted) {
      if (!args.engineTaskIds.has(task.id)) continue;

      let minQ = 0;
      for (const pred of sorted) {
        if (pred.order >= task.order) break;
        if (args.engineTaskIds.has(pred.id)) continue;
        if (!taskHasNoPendingWork(pred)) continue;

        const last = args.priorEnds.get(pred.id);
        if (!last) continue;

        let earliest = advanceToBusinessDay(
          addWaitHours(
            assignmentEndDateTime(last.date, last.endSlot),
            args.waitHoursByProcess.get(pred.process) ?? 0,
          ),
          args.holidayDates,
        );
        const q = dateTimeToWeekQuarter(args.weekStart, earliest);
        minQ = Math.max(minQ, q);
      }

      if (minQ >= HORIZON_Q) {
        deferredPastHorizon.add(task.id);
        continue;
      }
      if (minQ > 0) minByTask.set(task.id, minQ);
    }
  }

  return { minByTask, deferredPastHorizon };
}

function earliestStartIsoAfterAssignment(
  last: { date: Date; endSlot: number },
  waitHours: number,
  holidayDates: Set<string>,
): string {
  const afterWait = advanceToBusinessDay(
    addWaitHours(assignmentEndDateTime(last.date, last.endSlot), waitHours),
    holidayDates,
  );
  return toPlanningDayIso(afterWait);
}

/** Cadena Gantt: día más temprano en que puede empezar cada tarea según predecesoras en semanas previas. */
export function buildPriorChainStartIsoByTaskId(args: {
  tasks: LampTaskRef[];
  priorEnds: Map<string, { date: Date; endSlot: number }>;
  waitHoursByProcess: Map<string, number>;
  holidayDates: Set<string>;
}): Map<string, string> {
  const byLamp = new Map<string, LampTaskRef[]>();
  for (const t of args.tasks) {
    const list = byLamp.get(t.lampId) ?? [];
    list.push(t);
    byLamp.set(t.lampId, list);
  }

  const chainStart = new Map<string, string>();

  for (const group of byLamp.values()) {
    const sorted = [...group].sort(
      (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
    );
    let inheritedChain: string | null = null;

    for (const task of sorted) {
      if (inheritedChain) {
        chainStart.set(task.id, inheritedChain);
      }
      const last = args.priorEnds.get(task.id);
      if (last) {
        const next = earliestStartIsoAfterAssignment(
          last,
          args.waitHoursByProcess.get(task.process) ?? 0,
          args.holidayDates,
        );
        inheritedChain = inheritedChain
          ? maxIsoDate(inheritedChain, next)
          : next;
      }
    }
  }

  return chainStart;
}

function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Tras una tarea planificada en semana anterior, cuándo puede empezar la siguiente en cadena. */
export function buildNextChainAfterPriorTaskByTaskId(args: {
  tasks: LampTaskRef[];
  priorEnds: Map<string, { date: Date; endSlot: number }>;
  waitHoursByProcess: Map<string, number>;
  holidayDates: Set<string>;
}): Map<string, string> {
  const taskById = new Map(args.tasks.map((t) => [t.id, t]));
  const out = new Map<string, string>();
  for (const [taskId, last] of args.priorEnds) {
    const task = taskById.get(taskId);
    if (!task) continue;
    out.set(
      taskId,
      earliestStartIsoAfterAssignment(
        last,
        args.waitHoursByProcess.get(task.process) ?? 0,
        args.holidayDates,
      ),
    );
  }
  return out;
}

const priorPlanningWhere = (naveId: string, beforeWeekStart: Date) => ({
  planning: {
    naveId,
    weekStart: { lt: getMondayOf(beforeWeekStart) },
  },
});

export async function getPriorPlanningAssignments(args: {
  naveId: string;
  beforeWeekStart: Date;
}): Promise<PriorPlanningAssignment[]> {
  const rows = await prisma.planningAssignment.findMany({
    where: priorPlanningWhere(args.naveId, args.beforeWeekStart),
    select: { taskId: true, date: true, endSlot: true, hours: true },
    orderBy: [{ date: "asc" }, { endSlot: "asc" }],
  });
  return rows.map((r) => ({
    taskId: r.taskId,
    date: r.date,
    endSlot: r.endSlot,
    hours: r.hours,
  }));
}

export async function getPriorPlanningAssignmentsDetailed(args: {
  naveId: string;
  beforeWeekStart: Date;
}): Promise<PriorPlanningAssignmentDetail[]> {
  const rows = await prisma.planningAssignment.findMany({
    where: priorPlanningWhere(args.naveId, args.beforeWeekStart),
    select: {
      taskId: true,
      date: true,
      endSlot: true,
      hours: true,
      personId: true,
      person: {
        select: { id: true, iniciales: true, nombre: true, color: true },
      },
    },
    orderBy: [{ date: "asc" }, { endSlot: "asc" }],
  });
  return rows;
}

export async function sumPriorPlannedHoursByTaskId(args: {
  naveId: string;
  beforeWeekStart: Date;
}): Promise<Map<string, number>> {
  const rows = await prisma.planningAssignment.groupBy({
    by: ["taskId"],
    where: priorPlanningWhere(args.naveId, args.beforeWeekStart),
    _sum: { hours: true },
  });
  return new Map(
    rows.map((r) => [r.taskId, r._sum.hours ?? 0]),
  );
}
