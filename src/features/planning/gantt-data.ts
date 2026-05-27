import { riskFromPlannedEnd } from "@/lib/format";
import { toUtcDay } from "@/lib/week";
import type { GanttPlanningAssignment } from "@/features/planning/queries";
import type { getActiveProjectsForGantt } from "@/features/planning/queries";
import {
  buildContinuousTimeline,
  buildTaskTimelineBlocks,
  slotToStartMinutes,
  type GanttTimelineBlock,
} from "@/features/planning/gantt-timeline";

export type { GanttTimelineBlock } from "@/features/planning/gantt-timeline";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clave YYYY-MM-DD en UTC, alineada con el motor de planning. */
export function toPlanningDayIso(d: Date): string {
  return toUtcDay(d).toISOString().slice(0, 10);
}

function parsePlanningDay(iso: string): Date {
  return toUtcDay(new Date(`${iso}T00:00:00.000Z`));
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function nextBusinessDay(iso: string, holidayDates: Set<string>): string {
  let cursor = new Date(parsePlanningDay(iso).getTime() + DAY_MS);
  while (isWeekend(cursor) || holidayDates.has(toPlanningDayIso(cursor))) {
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return toPlanningDayIso(cursor);
}

function prevBusinessDay(iso: string, holidayDates: Set<string>): string {
  let cursor = new Date(parsePlanningDay(iso).getTime() - DAY_MS);
  while (isWeekend(cursor) || holidayDates.has(toPlanningDayIso(cursor))) {
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return toPlanningDayIso(cursor);
}

export interface GanttOperator {
  id: string;
  iniciales: string;
  nombre: string;
  color: string;
}

export interface GanttTaskRow {
  id: string;
  lampId: string;
  lampName: string | null;
  process: string;
  order: number;
  estimatedHours: number;
  doneHours: number;
  remainingWorkHours: number;
  pendingHours: number;
  /** Sin horas pendientes de planificar (completa en planificación previa o en obra). */
  isPlanningComplete: boolean;
  assignedHours: number;
  isAssigned: boolean;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  startSlot: number | null;
  endSlot: number | null;
  timelineBlocks: GanttTimelineBlock[];
  personIds: string[];
  /** Solo se rellena si el usuario debe verlo (p.ej. lámpara con >1 bastidor). */
  lampFrameLabel: string | null;
  operators: GanttOperator[];
}

export interface GanttLampRow {
  id: string;
  name: string | null;
  remainingWorkHours: number;
  assignedHours: number;
  isAssigned: boolean;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  startSlot: number | null;
  endSlot: number | null;
  timelineBlocks: GanttTimelineBlock[];
  operators: GanttOperator[];
  tasks: GanttTaskRow[];
}

export interface GanttProjectRow {
  id: string;
  name: string;
  deliveryDate: string | null;
  expectedCompletion: string | null;
  estimatedStart: string;
  estimatedEnd: string;
  startSlot: number | null;
  endSlot: number | null;
  timelineBlocks: GanttTimelineBlock[];
  remainingWorkHours: number;
  assignedHours: number;
  risk: "RIESGO" | "ATENCION" | "OK" | "SIN_FECHA";
  lamps: GanttLampRow[];
}

export interface GanttTaskOption {
  id: string;
  label: string;
}

export interface GanttProjectOption {
  id: string;
  name: string;
}

type GanttProjects = Awaited<ReturnType<typeof getActiveProjectsForGantt>>;
type RawTask = GanttProjects[number]["tasks"][number];

interface TaskScheduleInfo {
  plannedStart: string | null;
  plannedEnd: string | null;
  startSlot: number | null;
  endSlot: number | null;
  personIds: string[];
  assignedHours: number;
  operators: GanttOperator[];
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function mergeOperators(...groups: GanttOperator[][]): GanttOperator[] {
  const byId = new Map<string, GanttOperator>();
  for (const group of groups) {
    for (const op of group) {
      byId.set(op.id, op);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.iniciales.localeCompare(b.iniciales, "es"),
  );
}

function taskHasRemainingWork(task: {
  estimatedHours: number;
  doneHours: number;
}): boolean {
  return Math.max(0, task.estimatedHours - task.doneHours) > 1e-6;
}

export function buildTaskScheduleFromAssignments(
  assignments: GanttPlanningAssignment[],
  taskId: string,
): TaskScheduleInfo {
  const forTask = assignments.filter((a) => a.taskId === taskId);
  if (forTask.length === 0) {
    return {
      plannedStart: null,
      plannedEnd: null,
      startSlot: null,
      endSlot: null,
      personIds: [],
      assignedHours: 0,
      operators: [],
    };
  }

  const sorted = [...forTask].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  let min = toUtcDay(first.date);
  let max = toUtcDay(last.date);
  let assignedHours = 0;
  const operatorById = new Map<string, GanttOperator>();
  const personIds = new Set<string>();

  for (const a of forTask) {
    const day = toUtcDay(a.date);
    if (day.getTime() < min.getTime()) min = day;
    if (day.getTime() > max.getTime()) max = day;
    assignedHours += a.hours;
    personIds.add(a.personId);
    if (!operatorById.has(a.person.id)) {
      operatorById.set(a.person.id, {
        id: a.person.id,
        iniciales: a.person.iniciales,
        nombre: a.person.nombre,
        color: a.person.color,
      });
    }
  }

  return {
    plannedStart: toPlanningDayIso(min),
    plannedEnd: toPlanningDayIso(max),
    startSlot: first.startSlot,
    endSlot: last.endSlot,
    personIds: [...personIds],
    assignedHours,
    operators: [...operatorById.values()].sort((a, b) =>
      a.iniciales.localeCompare(b.iniciales, "es"),
    ),
  };
}

function buildPlannedEndByProject(
  assignments: GanttPlanningAssignment[],
): Map<string, Date> {
  const byProject = new Map<string, Date>();
  for (const a of assignments) {
    const pid = a.task.projectId;
    const cur = byProject.get(pid);
    if (!cur || a.date > cur) byProject.set(pid, a.date);
  }
  return byProject;
}

function buildTaskEstimatedRange(
  schedule: TaskScheduleInfo,
  chainStartIso: string | null,
): {
  estimatedStart: string | null;
  estimatedEnd: string | null;
  startSlot: number | null;
  endSlot: number | null;
  isAssigned: boolean;
} {
  if (!schedule.plannedStart || !schedule.plannedEnd) {
    return {
      estimatedStart: null,
      estimatedEnd: null,
      startSlot: null,
      endSlot: null,
      isAssigned: false,
    };
  }

  let startIso = schedule.plannedStart;
  if (chainStartIso) startIso = maxIso(chainStartIso, schedule.plannedStart);

  return {
    estimatedStart: startIso,
    estimatedEnd: schedule.plannedEnd,
    startSlot: schedule.startSlot,
    endSlot: schedule.endSlot,
    isAssigned: true,
  };
}

function enforceSequentialTasks(
  tasks: GanttTaskRow[],
  holidayDates: Set<string>,
): GanttTaskRow[] {
  if (tasks.length <= 1) return tasks;

  const sorted = [...tasks].sort(
    (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
  );
  const fixed: GanttTaskRow[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const task = { ...sorted[i]! };
    if (!task.isAssigned || !task.estimatedStart || !task.estimatedEnd) {
      fixed.push(task);
      continue;
    }

    const prevAssigned = [...fixed].reverse().find((t) => t.isAssigned);
    if (
      prevAssigned?.estimatedEnd &&
      task.estimatedStart <= prevAssigned.estimatedEnd
    ) {
      task.estimatedStart = nextBusinessDay(
        prevAssigned.estimatedEnd,
        holidayDates,
      );
      if (task.estimatedEnd < task.estimatedStart) {
        task.estimatedEnd = task.estimatedStart;
      }
      task.startSlot = 0;
    }
    fixed.push(task);
  }

  return fixed;
}

function buildTasksWithEstimates(
  tasks: RawTask[],
  assignments: GanttPlanningAssignment[],
  holidayDates: Set<string>,
  waitHoursByProcess: Map<string, number>,
  priorChainStartByTaskId: Map<string, string> = new Map(),
  nextChainAfterPriorTaskByTaskId: Map<string, string> = new Map(),
): GanttTaskRow[] {
  const byLamp = new Map<string, RawTask[]>();
  for (const t of tasks) {
    const list = byLamp.get(t.lampId) ?? [];
    list.push(t);
    byLamp.set(t.lampId, list);
  }

  const rows: GanttTaskRow[] = [];

  for (const lampTasks of byLamp.values()) {
    const sorted = [...lampTasks].sort(
      (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
    );
    const distinctFrameLabels = new Set(
      sorted
        .map((t) => {
          if (t.lampFrame?.label) return t.lampFrame.label;
          if (t.lampFrame?.frameType?.name) return t.lampFrame.frameType.name;
          if (t.lamp?.frameType?.name) return t.lamp.frameType.name;
          return null;
        })
        .filter((x): x is string => Boolean(x)),
    );
    const showFrameLabel = distinctFrameLabels.size > 1;
    let chainStartIso: string | null = null;
    const lampRows: GanttTaskRow[] = [];

    for (let ti = 0; ti < sorted.length; ti++) {
      const t = sorted[ti]!;
      const schedule = buildTaskScheduleFromAssignments(assignments, t.id);
      const pendingHours = Math.max(0, t.pendingHours);
      const isPlanningComplete = t.isCompleted;
      const priorChain = priorChainStartByTaskId.get(t.id) ?? null;
      const range = buildTaskEstimatedRange(
        schedule,
        chainStartIso ?? priorChain,
      );
      if (range.isAssigned && range.estimatedEnd) {
        chainStartIso = nextBusinessDay(range.estimatedEnd, holidayDates);
      } else if (nextChainAfterPriorTaskByTaskId.has(t.id)) {
        chainStartIso =
          nextChainAfterPriorTaskByTaskId.get(t.id) ?? chainStartIso;
      }

      const remainingWorkHours = Math.max(0, t.estimatedHours - t.doneHours);

      let capBefore: {
        dayIso: string;
        slot: number;
        minutes: number;
      } | null = null;
      const nextTask = sorted[ti + 1];
      if (nextTask) {
        const nextForTask = assignments
          .filter((a) => a.taskId === nextTask.id)
          .sort(
            (a, b) =>
              a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
          );
        const firstNext = nextForTask[0];
        if (firstNext) {
          capBefore = {
            dayIso: toPlanningDayIso(firstNext.date),
            slot: firstNext.startSlot,
            minutes: slotToStartMinutes(firstNext.startSlot),
          };
        }
      }

      const timelineBlocks = buildTaskTimelineBlocks(
        assignments,
        t.id,
        waitHoursByProcess.get(t.process) ?? 0,
        holidayDates,
        t.process,
        capBefore,
      );

      lampRows.push({
        id: t.id,
        lampId: t.lampId,
        lampName: t.lamp.name,
        process: t.process,
        order: t.order,
        estimatedHours: t.estimatedHours,
        doneHours: t.doneHours,
        remainingWorkHours,
        pendingHours,
        isPlanningComplete,
        assignedHours: schedule.assignedHours,
        isAssigned: range.isAssigned,
        estimatedStart: range.estimatedStart,
        estimatedEnd: range.estimatedEnd,
        startSlot: range.startSlot,
        endSlot: range.endSlot,
        timelineBlocks,
        personIds: schedule.personIds,
        lampFrameLabel: showFrameLabel
          ? t.lampFrame?.label ??
            t.lampFrame?.frameType?.name ??
            t.lamp?.frameType?.name ??
            null
          : null,
        operators: schedule.operators,
      });
    }

    rows.push(...enforceSequentialTasks(lampRows, holidayDates));
  }

  return rows;
}

function aggregateSlotRange(
  items: {
    estimatedStart: string | null;
    estimatedEnd: string | null;
    startSlot: number | null;
    endSlot: number | null;
  }[],
): {
  estimatedStart: string | null;
  estimatedEnd: string | null;
  startSlot: number | null;
  endSlot: number | null;
} {
  if (items.length === 0) {
    return {
      estimatedStart: null,
      estimatedEnd: null,
      startSlot: null,
      endSlot: null,
    };
  }

  let estimatedStart = items[0]!.estimatedStart!;
  let estimatedEnd = items[0]!.estimatedEnd!;
  let startSlot = items[0]!.startSlot;
  let endSlot = items[0]!.endSlot;

  for (const item of items) {
    if (!item.estimatedStart || !item.estimatedEnd) continue;
    if (item.estimatedStart < estimatedStart) {
      estimatedStart = item.estimatedStart;
      startSlot = item.startSlot;
    } else if (
      item.estimatedStart === estimatedStart &&
      item.startSlot != null &&
      (startSlot == null || item.startSlot < startSlot)
    ) {
      startSlot = item.startSlot;
    }
    if (item.estimatedEnd > estimatedEnd) {
      estimatedEnd = item.estimatedEnd;
      endSlot = item.endSlot;
    } else if (
      item.estimatedEnd === estimatedEnd &&
      item.endSlot != null &&
      (endSlot == null || item.endSlot > endSlot)
    ) {
      endSlot = item.endSlot;
    }
  }

  return { estimatedStart, estimatedEnd, startSlot, endSlot };
}

function groupTasksIntoLamps(
  tasks: GanttTaskRow[],
  waitHoursByProcess: Map<string, number>,
  holidayDates: Set<string>,
): GanttLampRow[] {
  const byLamp = new Map<string, GanttTaskRow[]>();
  for (const t of tasks) {
    const list = byLamp.get(t.lampId) ?? [];
    list.push(t);
    byLamp.set(t.lampId, list);
  }

  const lamps: GanttLampRow[] = [];
  for (const [lampId, lampTasks] of byLamp) {
    const ordered = [...lampTasks].sort(
      (a, b) => a.order - b.order || a.process.localeCompare(b.process, "es"),
    );
    const assigned = ordered.filter(
      (t) => t.isAssigned && t.estimatedStart && t.estimatedEnd,
    );
    const range = aggregateSlotRange(assigned);
    const assignedHours = ordered.reduce((a, t) => a + t.assignedHours, 0);
    const remainingWorkHours = ordered.reduce(
      (a, t) => a + t.remainingWorkHours,
      0,
    );

    lamps.push({
      id: lampId,
      name: ordered[0]?.lampName ?? null,
      remainingWorkHours,
      assignedHours,
      isAssigned: assigned.length > 0,
      estimatedStart: range.estimatedStart,
      estimatedEnd: range.estimatedEnd,
      startSlot: range.startSlot,
      endSlot: range.endSlot,
      timelineBlocks: buildContinuousTimeline(
        ordered,
        waitHoursByProcess,
        holidayDates,
        ordered[0]?.lampName ?? "Lámpara",
      ),
      operators: mergeOperators(...assigned.map((t) => t.operators)),
      tasks: ordered,
    });
  }

  return lamps.sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", "es"),
  );
}

function collectScheduledDates(
  projects: GanttProjectRow[],
): { starts: string[]; ends: string[] } {
  const starts: string[] = [];
  const ends: string[] = [];

  for (const p of projects) {
    if (p.estimatedStart) starts.push(p.estimatedStart);
    if (p.estimatedEnd) ends.push(p.estimatedEnd);
    if (p.deliveryDate) ends.push(p.deliveryDate);
    for (const l of p.lamps) {
      if (l.estimatedStart) starts.push(l.estimatedStart);
      if (l.estimatedEnd) ends.push(l.estimatedEnd);
      for (const t of l.tasks) {
        if (t.estimatedStart) starts.push(t.estimatedStart);
        if (t.estimatedEnd) ends.push(t.estimatedEnd);
      }
    }
  }

  return { starts, ends };
}

/** Rango del eje temporal a partir de los proyectos visibles. */
export function computeGanttAxisRange(
  projects: GanttProjectRow[],
  anchorDateIso: string,
  holidayDates: Set<string>,
): { axisStartIso: string; axisEndIso: string } {
  const { starts, ends } = collectScheduledDates(projects);

  if (starts.length === 0 && ends.length === 0) {
    let end = anchorDateIso;
    for (let i = 0; i < 19; i++) {
      end = nextBusinessDay(end, holidayDates);
    }
    return { axisStartIso: anchorDateIso, axisEndIso: end };
  }

  const axisStartIso =
    starts.length > 0
      ? starts.reduce((a, b) => minIso(a, b))
      : anchorDateIso;
  const axisEndIso =
    ends.length > 0 ? ends.reduce((a, b) => maxIso(a, b)) : anchorDateIso;

  return {
    axisStartIso: prevBusinessDay(axisStartIso, holidayDates),
    axisEndIso: nextBusinessDay(axisEndIso, holidayDates),
  };
}

export function buildGanttProjects({
  projects,
  assignments,
  personId,
  taskId,
  projectIds,
  anchorDateIso,
  holidayDates,
  waitHoursByProcess = new Map<string, number>(),
  priorChainStartByTaskId = new Map<string, string>(),
  nextChainAfterPriorTaskByTaskId = new Map<string, string>(),
}: {
  projects: GanttProjects;
  assignments: GanttPlanningAssignment[];
  personId?: string;
  taskId?: string;
  projectIds?: string[];
  anchorDateIso: string;
  holidayDates: Set<string>;
  waitHoursByProcess?: Map<string, number>;
  priorChainStartByTaskId?: Map<string, string>;
  nextChainAfterPriorTaskByTaskId?: Map<string, string>;
}): GanttProjectRow[] {
  const plannedEndByProject = buildPlannedEndByProject(assignments);
  if (projectIds?.length === 1 && projectIds[0] === "__none__") {
    return [];
  }

  const projectIdSet =
    projectIds && projectIds.length > 0 ? new Set(projectIds) : null;

  const rows: GanttProjectRow[] = [];

  for (const p of projects) {
    if (projectIdSet && !projectIdSet.has(p.id)) continue;

    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const remainingWorkHours = Math.max(0, estimatedHours - doneHours);
    if (remainingWorkHours <= 0) continue;

    const lastPlannedDate = plannedEndByProject.get(p.id) ?? null;
    const risk = riskFromPlannedEnd(p.deliveryDate, lastPlannedDate);

    const visibleTasks = p.tasks.filter(taskHasRemainingWork);
    if (visibleTasks.length === 0) continue;

    let taskRows = buildTasksWithEstimates(
      visibleTasks,
      assignments,
      holidayDates,
      waitHoursByProcess,
      priorChainStartByTaskId,
      nextChainAfterPriorTaskByTaskId,
    );

    if (personId) {
      taskRows = taskRows.filter((t) => t.personIds.includes(personId));
    }

    if (taskId) {
      if (!taskRows.some((t) => t.id === taskId)) continue;
      taskRows = taskRows.filter((t) => t.id === taskId);
    }

    const lamps = groupTasksIntoLamps(
      taskRows,
      waitHoursByProcess,
      holidayDates,
    );

    if (lamps.length === 0 && (personId || taskId)) continue;

    const assignedLamps = lamps.filter(
      (l) => l.isAssigned && l.estimatedStart && l.estimatedEnd,
    );
    const range = aggregateSlotRange(assignedLamps);
    const assignedHours = lamps.reduce((a, l) => a + l.assignedHours, 0);

    const deliveryIso = p.deliveryDate?.toISOString().slice(0, 10) ?? null;

    rows.push({
      id: p.id,
      name: p.name,
      deliveryDate: deliveryIso,
      expectedCompletion: lastPlannedDate?.toISOString().slice(0, 10) ?? null,
      estimatedStart: range.estimatedStart ?? anchorDateIso,
      estimatedEnd: range.estimatedEnd ?? anchorDateIso,
      startSlot: range.startSlot,
      endSlot: range.endSlot,
      timelineBlocks: buildContinuousTimeline(
        lamps.flatMap((l) => l.tasks),
        waitHoursByProcess,
        holidayDates,
        p.name,
      ),
      remainingWorkHours,
      assignedHours,
      risk,
      lamps,
    });
  }

  rows.sort((a, b) => {
    const dateA = a.deliveryDate
      ? new Date(`${a.deliveryDate}T00:00:00.000Z`).getTime()
      : Number.MAX_SAFE_INTEGER;
    const dateB = b.deliveryDate
      ? new Date(`${b.deliveryDate}T00:00:00.000Z`).getTime()
      : Number.MAX_SAFE_INTEGER;
    if (dateA !== dateB) return dateA - dateB;
    return b.remainingWorkHours - a.remainingWorkHours;
  });

  return rows;
}

export function buildGanttProjectOptions(
  projects: GanttProjects,
): GanttProjectOption[] {
  return projects
    .filter((p) => {
      const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
      const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
      return Math.max(0, estimatedHours - doneHours) > 1e-6;
    })
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function buildGanttTaskOptions(projects: GanttProjects): GanttTaskOption[] {
  const options: GanttTaskOption[] = [];
  for (const p of projects) {
    for (const t of p.tasks) {
      if (!taskHasRemainingWork(t)) continue;
      const lampLabel = t.lamp.name ?? "—";
      options.push({
        id: t.id,
        label: `${p.name} · ${lampLabel} · ${t.process}`,
      });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function filterGanttAssignments(
  assignments: GanttPlanningAssignment[],
  filters: {
    personIds?: string[];
    projectIds?: string[];
  },
): GanttPlanningAssignment[] {
  if (filters.projectIds?.length === 1 && filters.projectIds[0] === "__none__") {
    return [];
  }
  if (filters.personIds?.length === 1 && filters.personIds[0] === "__none__") {
    return [];
  }

  const projectIdSet =
    filters.projectIds && filters.projectIds.length > 0
      ? new Set(filters.projectIds)
      : null;
  const personIdSet =
    filters.personIds && filters.personIds.length > 0
      ? new Set(filters.personIds)
      : null;

  return assignments.filter((a) => {
    if (projectIdSet && !projectIdSet.has(a.task.projectId)) return false;
    if (personIdSet && !personIdSet.has(a.personId)) return false;
    return true;
  });
}

export function buildGanttMilestones(
  assignments: GanttPlanningAssignment[],
  axisStartIso: string,
  axisEndIso: string,
): { dateKey: string; dayLabel: string; lines: string[] }[] {
  const byDay = new Map<string, string[]>();

  for (const a of assignments) {
    const key = toPlanningDayIso(a.date);
    const lines = byDay.get(key) ?? [];
    lines.push(
      `${a.task.project.name} · ${a.process} · ${a.hours}h (${a.person.iniciales})`,
    );
    byDay.set(key, lines);
  }

  const axisDays: string[] = [];
  let cursor = parsePlanningDay(axisStartIso);
  const end = parsePlanningDay(axisEndIso);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) {
      axisDays.push(toPlanningDayIso(cursor));
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  const milestoneDays =
    axisDays.length > 30
      ? axisDays.filter((d) => (byDay.get(d)?.length ?? 0) > 0)
      : axisDays;

  return milestoneDays.map((dateKey) => ({
    dateKey,
    dayLabel: formatDayLabel(dateKey),
    lines: byDay.get(dateKey) ?? [],
  }));
}

function formatDayLabel(iso: string): string {
  const d = parsePlanningDay(iso);
  const dow = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"][d.getUTCDay()]!;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dow} ${day}/${month}`;
}

export function findGanttExpandTargets(
  projects: GanttProjectRow[],
  taskId?: string,
): { projectId?: string; lampId?: string } {
  if (!taskId) return {};
  for (const p of projects) {
    for (const l of p.lamps) {
      if (l.tasks.some((t) => t.id === taskId)) {
        return { projectId: p.id, lampId: l.id };
      }
    }
  }
  return {};
}
