import { riskFromPlannedEnd } from "@/lib/format";
import { toUtcDay } from "@/lib/week";
import type { PriorPlanningAssignmentDetail } from "@/features/planning/prior-week-planning";
import {
  aggregateWeekProgress,
  aggregateWeekTaskMetrics,
  computeWeekProgress,
  computeWeekTaskMetrics,
  taskHasRemainingToPlan,
  taskVisibleInGanttWeek,
  type WeekProgress,
} from "@/features/planning/week-progress";
import type {
  getActiveProjectsForGantt,
  getPlanningForWeek,
} from "@/features/planning/queries";

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
  weekScopeHours: number;
  priorPlannedHours: number;
  /** Sin horas pendientes de planificar (completa en semanas anteriores o en obra). */
  isPlanningComplete: boolean;
  assignedHoursWeek: number;
  progress: WeekProgress;
  isAssigned: boolean;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  personIds: string[];
  operators: GanttOperator[];
}

export interface GanttLampRow {
  id: string;
  name: string | null;
  remainingWorkHours: number;
  weekScopeHours: number;
  assignedHoursWeek: number;
  progress: WeekProgress;
  isAssigned: boolean;
  estimatedStart: string | null;
  estimatedEnd: string | null;
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
  remainingWorkHours: number;
  weekScopeHours: number;
  assignedHoursWeek: number;
  progress: WeekProgress;
  risk: "RIESGO" | "ATENCION" | "OK" | "SIN_FECHA";
  lamps: GanttLampRow[];
}

export interface GanttTaskOption {
  id: string;
  label: string;
}

type GanttProjects = Awaited<ReturnType<typeof getActiveProjectsForGantt>>;
type Planning = Awaited<ReturnType<typeof getPlanningForWeek>>;
type RawTask = GanttProjects[number]["tasks"][number];

interface TaskScheduleInfo {
  plannedStart: string | null;
  plannedEnd: string | null;
  personIds: string[];
  assignedHours: number;
  operators: GanttOperator[];
}

function taskProgressInput(
  task: RawTask,
  priorPlannedHours: number,
  assignedThisWeek: number,
) {
  return {
    estimatedHours: task.estimatedHours,
    doneHours: task.doneHours,
    priorPlannedHours,
    assignedThisWeekHours: assignedThisWeek,
  };
}

function buildTaskScheduleFromPrior(
  priorAssignments: PriorPlanningAssignmentDetail[],
  taskId: string,
): TaskScheduleInfo {
  const forTask = priorAssignments.filter((a) => a.taskId === taskId);
  if (forTask.length === 0) {
    return {
      plannedStart: null,
      plannedEnd: null,
      personIds: [],
      assignedHours: 0,
      operators: [],
    };
  }
  let min = toUtcDay(forTask[0]!.date);
  let max = toUtcDay(forTask[0]!.date);
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
    personIds: [...personIds],
    assignedHours,
    operators: [...operatorById.values()].sort((a, b) =>
      a.iniciales.localeCompare(b.iniciales, "es"),
    ),
  };
}

function buildTaskSchedule(planning: Planning, taskId: string): TaskScheduleInfo {
  if (!planning) {
    return {
      plannedStart: null,
      plannedEnd: null,
      personIds: [],
      assignedHours: 0,
      operators: [],
    };
  }
  const forTask = planning.assignments.filter((a) => a.taskId === taskId);
  if (forTask.length === 0) {
    return {
      plannedStart: null,
      plannedEnd: null,
      personIds: [],
      assignedHours: 0,
      operators: [],
    };
  }
  let min = toUtcDay(forTask[0]!.date);
  let max = toUtcDay(forTask[0]!.date);
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
    personIds: [...personIds],
    assignedHours,
    operators: [...operatorById.values()].sort((a, b) =>
      a.iniciales.localeCompare(b.iniciales, "es"),
    ),
  };
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

function buildTaskEstimatedRange(
  schedule: TaskScheduleInfo,
  chainStartIso: string | null,
): {
  estimatedStart: string | null;
  estimatedEnd: string | null;
  isAssigned: boolean;
} {
  if (!schedule.plannedStart || !schedule.plannedEnd) {
    return { estimatedStart: null, estimatedEnd: null, isAssigned: false };
  }

  let startIso = schedule.plannedStart;
  if (chainStartIso) startIso = maxIso(chainStartIso, schedule.plannedStart);

  return {
    estimatedStart: startIso,
    estimatedEnd: schedule.plannedEnd,
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
      task.estimatedStart = nextBusinessDay(prevAssigned.estimatedEnd, holidayDates);
      if (task.estimatedEnd < task.estimatedStart) {
        task.estimatedEnd = task.estimatedStart;
      }
    }
    fixed.push(task);
  }

  return fixed;
}

function buildTasksWithEstimates(
  tasks: RawTask[],
  planning: Planning,
  holidayDates: Set<string>,
  priorChainStartByTaskId: Map<string, string> = new Map(),
  nextChainAfterPriorTaskByTaskId: Map<string, string> = new Map(),
  priorAssignmentsDetailed: PriorPlanningAssignmentDetail[] = [],
  priorPlannedHoursByTask: Map<string, number> = new Map(),
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
    let chainStartIso: string | null = null;
    const lampRows: GanttTaskRow[] = [];

    for (const t of sorted) {
      const schedule = buildTaskSchedule(planning, t.id);
      const priorPlannedHours = priorPlannedHoursByTask.get(t.id) ?? 0;
      const pendingHours = Math.max(0, t.pendingHours);
      const isPlanningComplete = pendingHours <= 1e-6;
      const priorChain = priorChainStartByTaskId.get(t.id) ?? null;
      const range = buildTaskEstimatedRange(
        schedule,
        chainStartIso ?? priorChain,
      );
      if (range.isAssigned && range.estimatedEnd) {
        chainStartIso = nextBusinessDay(range.estimatedEnd, holidayDates);
      } else if (nextChainAfterPriorTaskByTaskId.has(t.id)) {
        chainStartIso = nextChainAfterPriorTaskByTaskId.get(t.id) ?? chainStartIso;
      }

      const priorSchedule = buildTaskScheduleFromPrior(
        priorAssignmentsDetailed,
        t.id,
      );
      const operators =
        range.isAssigned && schedule.operators.length > 0
          ? schedule.operators
          : isPlanningComplete
            ? priorSchedule.operators
            : schedule.operators;
      const personIds =
        range.isAssigned && schedule.personIds.length > 0
          ? schedule.personIds
          : isPlanningComplete
            ? priorSchedule.personIds
            : schedule.personIds;

      const weekMetrics = computeWeekTaskMetrics({
        estimatedHours: t.estimatedHours,
        doneHours: t.doneHours,
        priorPlannedHours,
        assignedThisWeekHours: schedule.assignedHours,
        pendingHours,
      });

      lampRows.push({
        id: t.id,
        lampId: t.lampId,
        lampName: t.lamp.name,
        process: t.process,
        order: t.order,
        estimatedHours: t.estimatedHours,
        doneHours: t.doneHours,
        remainingWorkHours: weekMetrics.remainingWorkHours,
        pendingHours: weekMetrics.pendingHours,
        weekScopeHours: weekMetrics.weekScopeHours,
        priorPlannedHours,
        isPlanningComplete,
        assignedHoursWeek: schedule.assignedHours,
        progress: computeWeekProgress(
          taskProgressInput(t, priorPlannedHours, schedule.assignedHours),
        ),
        isAssigned: range.isAssigned,
        estimatedStart: range.estimatedStart,
        estimatedEnd: range.estimatedEnd,
        personIds,
        operators,
      });
    }

    rows.push(...enforceSequentialTasks(lampRows, holidayDates));
  }

  return rows;
}

function groupTasksIntoLamps(tasks: GanttTaskRow[]): GanttLampRow[] {
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
    let estimatedStart: string | null = null;
    let estimatedEnd: string | null = null;
    if (assigned.length > 0) {
      estimatedStart = assigned[0]!.estimatedStart!;
      estimatedEnd = assigned[0]!.estimatedEnd!;
      for (const t of assigned) {
        estimatedStart = minIso(estimatedStart, t.estimatedStart!);
        estimatedEnd = maxIso(estimatedEnd, t.estimatedEnd!);
      }
    }
    const lampWeek = aggregateWeekTaskMetrics(
      ordered.map((t) =>
        computeWeekTaskMetrics({
          estimatedHours: t.estimatedHours,
          doneHours: t.doneHours,
          priorPlannedHours: t.priorPlannedHours,
          assignedThisWeekHours: t.assignedHoursWeek,
          pendingHours: t.pendingHours,
        }),
      ),
    );

    lamps.push({
      id: lampId,
      name: ordered[0]?.lampName ?? null,
      remainingWorkHours: lampWeek.remainingWorkHours,
      weekScopeHours: lampWeek.weekScopeHours,
      assignedHoursWeek: lampWeek.assignedThisWeekHours,
      progress: aggregateWeekProgress(
        ordered.map((t) => ({
          estimatedHours: t.estimatedHours,
          doneHours: t.doneHours,
          priorPlannedHours: t.priorPlannedHours,
          assignedThisWeekHours: t.assignedHoursWeek,
        })),
      ),
      isAssigned: assigned.length > 0,
      estimatedStart,
      estimatedEnd,
      operators: mergeOperators(...assigned.map((t) => t.operators)),
      tasks: ordered,
    });
  }

  return lamps.sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", "es"),
  );
}

export function buildGanttProjects({
  projects,
  planning,
  personId,
  taskId,
  anchorDateIso,
  holidayDates,
  priorChainStartByTaskId = new Map<string, string>(),
  nextChainAfterPriorTaskByTaskId = new Map<string, string>(),
  priorAssignmentsDetailed = [] as PriorPlanningAssignmentDetail[],
  priorPlannedHoursByTask = new Map<string, number>(),
}: {
  projects: GanttProjects;
  planning: Planning;
  personId?: string;
  taskId?: string;
  anchorDateIso: string;
  holidayDates: Set<string>;
  priorChainStartByTaskId?: Map<string, string>;
  nextChainAfterPriorTaskByTaskId?: Map<string, string>;
  priorAssignmentsDetailed?: PriorPlanningAssignmentDetail[];
  priorPlannedHoursByTask?: Map<string, number>;
}): GanttProjectRow[] {
  const plannedEndByProject = new Map<string, Date>();
  if (planning) {
    for (const a of planning.assignments) {
      const pid = a.task.projectId;
      const cur = plannedEndByProject.get(pid);
      if (!cur || a.date > cur) plannedEndByProject.set(pid, a.date);
    }
  }

  const assignedThisWeekByTask = new Map<string, number>();
  if (planning) {
    for (const a of planning.assignments) {
      assignedThisWeekByTask.set(
        a.taskId,
        (assignedThisWeekByTask.get(a.taskId) ?? 0) + a.hours,
      );
    }
  }

  const rows: GanttProjectRow[] = [];

  for (const p of projects) {
    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const remainingWorkHours = Math.max(0, estimatedHours - doneHours);
    if (remainingWorkHours <= 0) continue;

    const lastPlannedDate = plannedEndByProject.get(p.id) ?? null;
    const risk = riskFromPlannedEnd(p.deliveryDate, lastPlannedDate);

    const weekTasks = p.tasks.filter((t) =>
      taskVisibleInGanttWeek(
        t,
        assignedThisWeekByTask.get(t.id) ?? 0,
      ),
    );
    if (weekTasks.length === 0) continue;

    const projectProgress = aggregateWeekProgress(
      p.tasks.map((t) =>
        taskProgressInput(
          t,
          priorPlannedHoursByTask.get(t.id) ?? 0,
          assignedThisWeekByTask.get(t.id) ?? 0,
        ),
      ),
    );

    let taskRows = buildTasksWithEstimates(
      weekTasks,
      planning,
      holidayDates,
      priorChainStartByTaskId,
      nextChainAfterPriorTaskByTaskId,
      priorAssignmentsDetailed,
      priorPlannedHoursByTask,
    );

    if (personId) {
      taskRows = taskRows.filter((t) => t.personIds.includes(personId));
    }

    if (taskId) {
      if (!taskRows.some((t) => t.id === taskId)) continue;
      taskRows = taskRows.filter((t) => t.id === taskId);
    }

    const lamps = groupTasksIntoLamps(taskRows);

    if (lamps.length === 0 && (personId || taskId)) continue;

    let estimatedStart: string | null = null;
    let estimatedEnd: string | null = null;
    let assignedHoursWeek = 0;
    const assignedLamps = lamps.filter(
      (l) => l.isAssigned && l.estimatedStart && l.estimatedEnd,
    );
    if (assignedLamps.length > 0) {
      estimatedStart = assignedLamps[0]!.estimatedStart!;
      estimatedEnd = assignedLamps[0]!.estimatedEnd!;
      for (const l of assignedLamps) {
        estimatedStart = minIso(estimatedStart, l.estimatedStart!);
        estimatedEnd = maxIso(estimatedEnd, l.estimatedEnd!);
        assignedHoursWeek += l.assignedHoursWeek;
      }
    }

    const deliveryIso = p.deliveryDate?.toISOString().slice(0, 10) ?? null;
    if (deliveryIso && estimatedEnd) {
      estimatedEnd = maxIso(estimatedEnd, deliveryIso);
    } else if (deliveryIso && !estimatedEnd) {
      estimatedEnd = deliveryIso;
      estimatedStart = estimatedStart ?? anchorDateIso;
    }

    const projectWeek = aggregateWeekTaskMetrics(
      weekTasks.map((t) =>
        computeWeekTaskMetrics({
          estimatedHours: t.estimatedHours,
          doneHours: t.doneHours,
          priorPlannedHours: priorPlannedHoursByTask.get(t.id) ?? 0,
          assignedThisWeekHours: assignedThisWeekByTask.get(t.id) ?? 0,
          pendingHours: t.pendingHours,
        }),
      ),
    );

    rows.push({
      id: p.id,
      name: p.name,
      deliveryDate: deliveryIso,
      expectedCompletion: lastPlannedDate?.toISOString().slice(0, 10) ?? null,
      estimatedStart: estimatedStart ?? anchorDateIso,
      estimatedEnd: estimatedEnd ?? anchorDateIso,
      remainingWorkHours,
      weekScopeHours: projectWeek.weekScopeHours,
      assignedHoursWeek,
      progress: projectProgress,
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

export function buildGanttTaskOptions(
  projects: GanttProjects,
  assignedThisWeekByTask: Map<string, number> = new Map(),
): GanttTaskOption[] {
  const options: GanttTaskOption[] = [];
  for (const p of projects) {
    for (const t of p.tasks) {
      if (
        !taskVisibleInGanttWeek(
          t,
          assignedThisWeekByTask.get(t.id) ?? 0,
        )
      ) {
        continue;
      }
      const lampLabel = t.lamp.name ?? "—";
      options.push({
        id: t.id,
        label: `${p.name} · ${lampLabel} · ${t.process}`,
      });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function filterPlanningAssignments(
  planning: Planning,
  filters: { personId?: string; taskId?: string },
) {
  if (!planning) return [];
  return planning.assignments.filter((a) => {
    if (filters.personId && a.personId !== filters.personId) return false;
    if (filters.taskId && a.taskId !== filters.taskId) return false;
    return true;
  });
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
