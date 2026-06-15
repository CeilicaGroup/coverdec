import { PlanningStatus } from "@/generated/prisma";
import { absenceOverlapPrismaFilter } from "@/features/people/absence-model";
import { resolveTimeEntryHours } from "@/features/time-tracking/entry-hours";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { isoWeek } from "@/lib/week";
import {
  isPlanningVisible,
  type PlanningViewMode,
} from "@/features/planning/planning-visibility";
import { daysUntil, riskFromDelivery, riskFromPlannedEnd } from "@/lib/format";
import type { ProcessBadgeStyle } from "@/components/process-badge";
import {
  AFTERNOON_END,
  AFTERNOON_START,
  MORNING_END,
  MORNING_START,
} from "@/features/planning/engine/types";
import {
  DEFAULT_PLANNING_WEIGHTS,
  normalizePlanningWeights,
  type PlanningWeights,
} from "@/features/planning/policy-schema";
import {
  aggregateWeekTaskMetrics,
  computeWeekProgress,
  computeWeekTaskMetrics,
} from "@/features/planning/week-progress";
import { isTaskClosedForPlanning } from "@/features/planning/task-planning-status";
import type { PlanningAssignmentSlice } from "@/features/planning/planning-timeline";
import type { ProcessCode } from "@/types/process";
import {
  computeTaskHourTotals,
  loadDoneHoursByTaskIds,
} from "@/features/time-tracking/task-hours-derived";

const DAY_MS = 24 * 60 * 60 * 1000;

function mapPlanningAssignments<
  T extends {
    assignments: {
      person: { user: { name: string | null } | null; iniciales: string };
    }[];
  },
>(planning: T) {
  return {
    ...planning,
    assignments: planning.assignments.map((a) => ({
      ...a,
      person: {
        ...a.person,
        nombre: a.person.user?.name ?? a.person.iniciales,
      },
    })),
  };
}

/** Metadatos del planning de la semana (sin filtrar por vista). */
export async function getPlanningWeekMeta({
  naveScope,
  weekStart,
}: {
  naveScope: string[] | null;
  weekStart: Date;
}) {
  const monday = getMondayOf(weekStart);
  const { year, week } = isoWeek(monday);
  if (naveScope !== null && naveScope.length === 0) return null;

  if (naveScope !== null && naveScope.length === 1) {
    return prisma.planning.findUnique({
      where: { naveId_year_week: { naveId: naveScope[0]!, year, week } },
      select: { id: true, status: true, publishedAt: true, naveId: true },
    });
  }

  const rows = await prisma.planning.findMany({
    where: {
      year,
      week,
      ...(naveScope !== null ? { naveId: { in: naveScope } } : {}),
    },
    select: { id: true, status: true, publishedAt: true, naveId: true },
    orderBy: { naveId: "asc" },
  });
  return rows[0] ?? null;
}

export async function getPlanningForWeek({
  naveScope,
  weekStart,
  viewMode = "published_only",
}: {
  /** null = todas las naves; [] = ninguna; [ids] = subconjunto */
  naveScope: string[] | null;
  weekStart: Date;
  viewMode?: PlanningViewMode;
}) {
  const monday = getMondayOf(weekStart);
  const { year, week } = isoWeek(monday);
  const include = {
    assignments: {
      include: {
        person: { include: { user: { select: { name: true } } } },
        task: {
          include: {
            project: true,
            lamp: { include: { elementType: { select: { name: true } } } },
            lampElement: { include: { elementType: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ date: "asc" as const }, { startSlot: "asc" as const }],
    },
  };

  if (naveScope !== null && naveScope.length === 0) return null;

  if (naveScope !== null && naveScope.length === 1) {
    const planning = await prisma.planning.findUnique({
      where: { naveId_year_week: { naveId: naveScope[0]!, year, week } },
      include,
    });
    if (!planning) return null;
    if (!isPlanningVisible(planning.status, viewMode)) return null;
    return mapPlanningAssignments(planning);
  }

  const plannings = await prisma.planning.findMany({
    where: {
      year,
      week,
      ...(naveScope !== null ? { naveId: { in: naveScope } } : {}),
    },
    include,
  });
  const visible = plannings.filter((p) =>
    isPlanningVisible(p.status, viewMode),
  );
  if (visible.length === 0) return null;

  const allAssignments = visible
    .flatMap((p) => p.assignments)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot);

  return {
    ...visible[0]!,
    id: "__all__",
    naveId: "__all__",
    assignments: allAssignments.map((a) => ({
      ...a,
      person: {
        ...a.person,
        nombre: a.person.user?.name ?? a.person.iniciales,
      },
    })),
  };
}

/** Assignment row shape returned by {@link getPlanningForWeek} (before timeline narrowing). */
export interface PlanningWeekAssignmentInput {
  id: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: string;
  personId: string;
  person: {
    id: string;
    iniciales: string;
    color: string;
    alias: string | null;
    nombre?: string;
    user?: { name: string | null } | null;
  };
  task: {
    id: string;
    order: number;
    isCompleted: boolean;
    projectId: string;
    lampId: string;
    lamp: PlanningAssignmentSlice["task"]["lamp"];
    lampElement?: PlanningAssignmentSlice["task"]["lampElement"];
    project: { name: string };
  };
}

/** Narrow planning query rows into the slice expected by timeline/progress helpers. */
export function toPlanningAssignmentSlices(
  assignments: ReadonlyArray<PlanningWeekAssignmentInput>,
): PlanningAssignmentSlice[] {
  return assignments.map((a) => ({
    id: a.id,
    date: a.date,
    startSlot: a.startSlot,
    endSlot: a.endSlot,
    hours: a.hours,
    process: a.process as ProcessCode,
    personId: a.personId,
    person: {
      id: a.person.id,
      iniciales: a.person.iniciales,
      color: a.person.color,
      alias: a.person.alias,
      nombre: a.person.nombre ?? a.person.user?.name ?? a.person.iniciales,
    },
    task: {
      id: a.task.id,
      order: a.task.order,
      isCompleted: a.task.isCompleted,
      projectId: a.task.projectId,
      lampId: a.task.lampId,
      lamp: a.task.lamp,
      lampElement: a.task.lampElement,
      project: { name: a.task.project.name },
    },
  }));
}

export interface ProcessDefinitionInfo {
  waitHours: number;
  badge: ProcessBadgeStyle;
}

const personInclude = {
  specialties: true,
  workWindows: true,
  scheduleOverrides: { include: { windows: true } },
  user: { select: { name: true } },
  personNaves: { include: { nave: { select: { id: true, codigo: true, nombre: true } } } },
} as const;

function deriveDailyHoursFromWindows(
  windows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): number {
  const byDay = new Map<number, number>();
  for (const w of windows) {
    const span = Math.max(0, w.endMinutes - w.startMinutes) / 60;
    byDay.set(w.dayOfWeek, (byDay.get(w.dayOfWeek) ?? 0) + span);
  }
  const total = [1, 2, 3, 4, 5].reduce((acc, d) => acc + (byDay.get(d) ?? 0), 0);
  return total > 0 ? total / 5 : 8;
}

export async function getNavePersonnel(naveScope: string[] | null) {
  if (naveScope !== null && naveScope.length === 0) return [];
  const rows = naveScope === null
    ? await prisma.person.findMany({
      where: { isActive: true },
      include: personInclude,
      orderBy: { iniciales: "asc" },
    })
    : await prisma.person.findMany({
      where: {
        isActive: true,
        personNaves: { some: { naveId: { in: naveScope } } },
      },
      include: personInclude,
      orderBy: { iniciales: "asc" },
    });

  return rows.map((p) => {
    const capacityHours = deriveDailyHoursFromWindows(p.workWindows);
    return {
      ...p,
      nombre: p.user?.name ?? p.iniciales,
      capacityHours,
    };
  });
}

export interface ActualHourEntry {
  id: string;
  userId: string;
  /** ISO date string "YYYY-MM-DD" derived from startedAt UTC */
  date: string;
  startedAt: Date;
  endedAt: Date | null;
  hours: number;
  isRunning: boolean;
  process: string | null;
  notes: string | null;
  personId: string | null;
  person: { id: string; nombre: string; iniciales: string; color: string } | null;
  taskId: string | null;
  task: {
    id: string;
    process: string;
    projectId: string;
    lampId: string;
    isCompleted: boolean;
    lampElement?: { label: string | null; elementType?: { name: string } | null } | null;
    lamp?: { elementType?: { name: string } | null } | null;
  } | null;
  project: { id: string; name: string } | null;
  lamp: { id: string; name: string } | null;
}

export async function getActualHoursForWeek({
  naveScope,
  weekStart,
  userId,
}: {
  naveScope: string[] | null;
  weekStart: Date;
  userId?: string;
}): Promise<ActualHourEntry[]> {
  const monday = getMondayOf(weekStart);
  const saturdayStart = new Date(monday.getTime() + 5 * 86_400_000);

  if (naveScope !== null && naveScope.length === 0) return [];

  const entries = await prisma.timeEntry.findMany({
    where: {
      ...(userId ? { userId } : {}),
      startedAt: { gte: monday, lt: saturdayStart },
      OR: [
        { endedAt: { not: null }, hours: { gt: 0 } },
        { endedAt: null },
      ],
      user: {
        personId: { not: null },
        ...(naveScope !== null
          ? { person: { personNaves: { some: { naveId: { in: naveScope } } } } }
          : {}),
      },
    },
    include: {
      user: { include: { person: { include: { user: { select: { name: true } } } } } },
      project: { select: { id: true, name: true } },
      lamp: { select: { id: true, name: true } },
      task: {
        select: {
          id: true,
          process: true,
          projectId: true,
          lampId: true,
          isCompleted: true,
          lampElement: {
            select: { label: true, elementType: { select: { name: true } } },
          },
          lamp: { select: { elementType: { select: { name: true } } } },
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  return entries.map((e) => {
    const endedAt = e.endedAt ?? null;
    const isRunning = endedAt == null;
    const hours = resolveTimeEntryHours(e);
    return {
    id: e.id,
    userId: e.userId,
    date: e.startedAt.toISOString().slice(0, 10),
    startedAt: e.startedAt,
    endedAt,
    hours,
    isRunning,
    process: e.process,
    notes: e.notes,
    personId: e.user.personId,
    person: e.user.person
      ? {
          id: e.user.person.id,
          nombre: e.user.person.user?.name ?? e.user.person.iniciales,
          iniciales: e.user.person.iniciales,
          color: e.user.person.color,
        }
      : null,
    taskId: e.taskId,
    task: e.task
      ? {
          id: e.task.id,
          process: e.task.process,
          projectId: e.task.projectId,
          lampId: e.task.lampId,
          isCompleted: e.task.isCompleted,
          lampElement: e.task.lampElement,
          lamp: e.task.lamp,
        }
      : null,
    project: e.project,
    lamp: e.lamp,
    };
  });
}

function timeToProductiveSlot(
  hour: number,
  minute: number,
  asEnd: boolean,
): number {
  const decimal = hour + minute / 60;
  const h = Math.max(MORNING_START, Math.min(AFTERNOON_END, decimal));
  if (h <= MORNING_END) {
    return Math.max(0, Math.min(MORNING_END - MORNING_START, h - MORNING_START));
  }
  if (h < AFTERNOON_START) {
    return asEnd ? MORNING_END - MORNING_START : MORNING_END - MORNING_START;
  }
  return (
    MORNING_END - MORNING_START +
    Math.max(0, Math.min(AFTERNOON_END - AFTERNOON_START, h - AFTERNOON_START))
  );
}

/** Festivos cuyo rango intersecta [start, end] (inclusive por día UTC). */
export async function getHolidaysForRange(start: Date, end: Date) {
  return prisma.holiday.findMany({
    where: {
      AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }],
    },
    orderBy: { startDate: "asc" },
  });
}

export async function getAbsencesForRange(start: Date, end: Date) {
  return prisma.absence.findMany({
    where: absenceOverlapPrismaFilter(start, end),
    include: { person: true },
    orderBy: { date: "asc" },
  });
}

export async function getActiveProjectsWithLoad(naveScope: string[] | null) {
  if (naveScope !== null && naveScope.length === 0) return [];
  const taskNaveFilter =
    naveScope !== null ? { naveId: { in: naveScope } } : undefined;
  const projects = await prisma.project.findMany({
    where:
      naveScope !== null
        ? { isActive: true, tasks: { some: taskNaveFilter! } }
        : { isActive: true },
    include: {
      tasks: {
        where: taskNaveFilter,
        select: {
          id: true,
          process: true,
          estimatedHours: true,
          isCompleted: true,
        },
      },
    },
    orderBy: [
      { deliveryDate: { sort: "asc", nulls: "last" } },
      { name: "asc" },
    ],
  });
  const taskIds = projects.flatMap((project) => project.tasks.map((task) => task.id));
  const doneByTaskId = await loadDoneHoursByTaskIds(prisma, taskIds);
  return projects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => {
      const totals = computeTaskHourTotals(
        task.estimatedHours,
        doneByTaskId.get(task.id) ?? 0,
      );
      return {
        ...task,
        doneHours: totals.doneHours,
        pendingHours: totals.remainingWorkHours,
      };
    }),
  }));
}

/** Asignaciones de planning de proyectos activos (todas las semanas) para el Gantt global. */
export async function getGanttPlanningAssignments(
  naveScope: string[] | null,
  viewMode: PlanningViewMode = "published_only",
) {
  if (naveScope !== null && naveScope.length === 0) return [];
  const naveIn = naveScope !== null ? { in: naveScope } : undefined;
  const planningStatus =
    viewMode === "published_only"
      ? { status: PlanningStatus.PUBLISHED }
      : {};
  const rows = await prisma.planningAssignment.findMany({
    where: {
      task: {
        project: { isActive: true },
        ...(naveIn ? { naveId: naveIn } : {}),
      },
      ...(naveIn
        ? { planning: { naveId: naveIn, ...planningStatus } }
        : { planning: planningStatus }),
    },
    select: {
      taskId: true,
      personId: true,
      date: true,
      startSlot: true,
      endSlot: true,
      hours: true,
      process: true,
      person: {
        select: {
          id: true,
          iniciales: true,
          alias: true,
          color: true,
          user: { select: { name: true } },
        },
      },
      task: {
        select: {
          id: true,
          process: true,
          isCompleted: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          lamp: {
            select: {
              id: true,
              name: true,
              elementType: { select: { name: true } },
            },
          },
          lampElement: {
            select: {
              id: true,
              label: true,
              elementType: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ date: "asc" }, { startSlot: "asc" }],
  });
  return rows.map((a) => ({
    ...a,
    person: {
      id: a.person.id,
      iniciales: a.person.iniciales,
      color: a.person.color,
      nombre: a.person.user?.name ?? a.person.iniciales,
    },
  }));
}

/** Registros reales normalizados al shape de asignaciones para reutilizar renderer Gantt. */
export async function getGanttActualAssignments(
  naveScope: string[] | null,
): Promise<Awaited<ReturnType<typeof getGanttPlanningAssignments>>> {
  if (naveScope !== null && naveScope.length === 0) return [];
  const naveIn = naveScope !== null ? { in: naveScope } : undefined;
  const rows = await prisma.timeEntry.findMany({
    where: {
      taskId: { not: null },
      task: {
        project: { isActive: true },
        ...(naveIn ? { naveId: naveIn } : {}),
      },
      OR: [
        { endedAt: { not: null }, hours: { gt: 0 } },
        { endedAt: null },
      ],
      user: {
        personId: { not: null },
        ...(naveIn
          ? { person: { personNaves: { some: { naveId: { in: naveScope! } } } } }
          : {}),
      },
    },
    select: {
      taskId: true,
      startedAt: true,
      endedAt: true,
      hours: true,
      process: true,
      user: {
        select: {
          person: {
            select: {
              id: true,
              iniciales: true,
              color: true,
              user: { select: { name: true } },
            },
          },
        },
      },
      task: {
        select: {
          id: true,
          process: true,
          isCompleted: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          lamp: {
            select: {
              id: true,
              name: true,
              elementType: { select: { name: true } },
            },
          },
          lampElement: {
            select: {
              id: true,
              label: true,
              elementType: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ startedAt: "asc" }],
  });

  return rows
    .filter((e) => e.taskId && e.user.person && e.task)
    .map((e) => {
      const start = e.startedAt;
      const end = e.endedAt ?? new Date();
      const day = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
      );
      const hours = resolveTimeEntryHours(e, end);
      return {
        taskId: e.taskId!,
        personId: e.user.person!.id,
        date: day,
        startSlot: timeToProductiveSlot(
          start.getUTCHours(),
          start.getUTCMinutes(),
          false,
        ),
        endSlot: timeToProductiveSlot(end.getUTCHours(), end.getUTCMinutes(), true),
        hours,
        process: e.process ?? e.task!.process,
        person: {
          id: e.user.person!.id,
          iniciales: e.user.person!.iniciales,
          color: e.user.person!.color,
          nombre: e.user.person!.user?.name ?? e.user.person!.iniciales,
        },
        task: e.task!,
      };
    });
}

export type GanttPlanningAssignment = Awaited<
  ReturnType<typeof getGanttPlanningAssignments>
>[number];

/** Proyectos activos con tareas y lámpara para la vista Gantt. */
export async function getActiveProjectsForGantt(naveScope: string[] | null) {
  if (naveScope !== null && naveScope.length === 0) return [];
  const taskNaveFilter =
    naveScope !== null ? { naveId: { in: naveScope } } : undefined;
  return prisma.project.findMany({
    where:
      naveScope !== null
        ? { isActive: true, tasks: { some: taskNaveFilter! } }
        : { isActive: true },
    include: {
      tasks: {
        where: taskNaveFilter,
        select: {
          id: true,
          lampId: true,
          process: true,
          order: true,
          estimatedHours: true,
          isCompleted: true,
          lamp: {
            select: {
              id: true,
              name: true,
              elementType: { select: { name: true } },
            },
          },
          lampElementId: true,
          lampElement: {
            select: {
              id: true,
              label: true,
              elementType: { select: { name: true } },
            },
          },
        },
        orderBy: [{ order: "asc" }, { process: "asc" }],
      },
    },
    orderBy: [
      { deliveryDate: { sort: "asc", nulls: "last" } },
      { name: "asc" },
    ],
  }).then(async (projects) => {
    const taskIds = projects.flatMap((project) => project.tasks.map((task) => task.id));
    const doneByTaskId = await loadDoneHoursByTaskIds(prisma, taskIds);
    return projects.map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => {
        const totals = computeTaskHourTotals(
          task.estimatedHours,
          doneByTaskId.get(task.id) ?? 0,
        );
        return {
          ...task,
          doneHours: totals.doneHours,
          pendingHours: totals.remainingWorkHours,
        };
      }),
    }));
  });
}

export async function getProcessDefinitionsByCode(): Promise<
  Map<string, ProcessDefinitionInfo>
> {
  const rows = await prisma.processDefinition.findMany({
    select: {
      code: true,
      label: true,
      waitHours: true,
      bgColor: true,
      fgColor: true,
      borderColor: true,
    },
  });
  return new Map(
    rows.map((p) => [
      p.code,
      {
        waitHours: p.waitHours,
        badge: {
          label: p.label,
          bgColor: p.bgColor,
          fgColor: p.fgColor,
          borderColor: p.borderColor,
        },
      },
    ]),
  );
}

export async function getProcessBadgeStylesByCode(): Promise<
  Map<string, ProcessBadgeStyle>
> {
  const defs = await getProcessDefinitionsByCode();
  return new Map([...defs.entries()].map(([code, d]) => [code, d.badge]));
}

export async function getPlanningWeights(
  naveId: string | null,
): Promise<PlanningWeights> {
  if (!naveId) return { ...DEFAULT_PLANNING_WEIGHTS };
  const row = await prisma.planningPolicy.findUnique({ where: { naveId } });
  if (!row) return { ...DEFAULT_PLANNING_WEIGHTS };
  return normalizePlanningWeights(row);
}

export interface PlanningDeadlineSettings {
  globalDeadlineBoost: number;
  deadlineCurveExponent: number;
  overduePenaltyMultiplier: number;
}

export async function getPlanningDeadlineSettings(
  naveId: string | null,
): Promise<PlanningDeadlineSettings> {
  if (!naveId) {
    return {
      globalDeadlineBoost: 50,
      deadlineCurveExponent: 2,
      overduePenaltyMultiplier: 2.5,
    };
  }
  const row = await prisma.planningPolicy.findUnique({
    where: { naveId },
    select: {
      wPriority: true,
      deadlineCurveExponent: true,
      overduePenaltyMultiplier: true,
    },
  });
  const globalDeadlineBoost = row
    ? Math.round((row.wPriority / 5) * 100)
    : 50;
  return {
    globalDeadlineBoost,
    deadlineCurveExponent: row?.deadlineCurveExponent ?? 2,
    overduePenaltyMultiplier: row?.overduePenaltyMultiplier ?? 2.5,
  };
}

export interface ActiveProjectRow {
  projectId: string;
  name: string;
  code: string;
  planningPreset: "A_TIEMPO" | "EQUILIBRADO" | "MIN_COSTE";
  planningCostPriority: number;
  planningStability: number;
  planningDeadlineBoost: number;
  deliveryDate: Date | null;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  /** Resto de obra (estimado − hecho), independiente del pending del motor de planning. */
  remainingWorkHours: number;
  /** Horas de planificación de esta semana (pendiente + asignado en la semana). */
  weekScopeHours: number;
  assignedThisWeek: number;
  progressPct: number;
  /** % avance esperado al terminar esta semana = (hecho + asignado) / estimado × 100 */
  expectedProgressPct: number;
  risk: "OK" | "ATENCION" | "RIESGO" | "SIN_FECHA";
  daysLeft: number | null;
  /** Última fecha de asignación real en el planning de la semana (no estimación por capacidad). */
  expectedCompletion: Date | null;
  pendingProcesses: string[];
}

function buildAssignedByProject(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
): Map<string, number> {
  const assignedByProject = new Map<string, number>();
  if (!planning) return assignedByProject;
  for (const a of planning.assignments) {
    const projectId = a.task.projectId;
    assignedByProject.set(
      projectId,
      (assignedByProject.get(projectId) ?? 0) + a.hours,
    );
  }
  return assignedByProject;
}

function buildAssignedHoursByTaskId(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
): Map<string, number> {
  const byTask = new Map<string, number>();
  if (!planning) return byTask;
  for (const a of planning.assignments) {
    byTask.set(a.taskId, (byTask.get(a.taskId) ?? 0) + a.hours);
  }
  return byTask;
}

function buildPlannedEndByProjectFromPlanning(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
): Map<string, Date> {
  const byProject = new Map<string, Date>();
  if (!planning) return byProject;
  for (const a of planning.assignments) {
    const pid = a.task.projectId;
    const cur = byProject.get(pid);
    if (!cur || a.date > cur) byProject.set(pid, a.date);
  }
  return byProject;
}

function pendingToPlanHoursForTask(
  task: {
    id: string;
    estimatedHours: number;
    doneHours: number;
    isCompleted: boolean;
  },
  priorPlannedHoursByTask: Map<string, number>,
  assignedThisWeekByTask: Map<string, number>,
): number {
  if (task.isCompleted) return 0;
  const remaining = Math.max(0, task.estimatedHours - task.doneHours);
  const prior = priorPlannedHoursByTask.get(task.id) ?? 0;
  const assigned = assignedThisWeekByTask.get(task.id) ?? 0;
  return Math.max(0, remaining - prior - assigned);
}

function pendingProcessesForProject(
  tasks: {
    process: string;
    pendingToPlanHours: number;
    remainingWorkHours: number;
    estimatedHours: number;
    isCompleted: boolean;
  }[],
): string[] {
  return Array.from(
    new Set(
      tasks
        .filter((t) => !isTaskClosedForPlanning(t) && t.pendingToPlanHours > 1e-6)
        .map((t) => t.process),
    ),
  );
}

function remainingWorkHoursForProject(
  tasks: {
    estimatedHours: number;
    remainingWorkHours: number;
    pendingToPlanHours: number;
    isCompleted: boolean;
  }[],
): number {
  return tasks
    .filter((t) =>
      !isTaskClosedForPlanning({
        estimatedHours: t.estimatedHours,
        isCompleted: t.isCompleted,
        pendingToPlanHours: t.pendingToPlanHours,
        remainingWorkHours: t.remainingWorkHours,
      })
    )
    .reduce((acc, t) => acc + t.remainingWorkHours, 0);
}

/** Todos los proyectos activos con carga y proyección de fin. */
export function summarizeAllActiveProjects(
  projects: Awaited<ReturnType<typeof getActiveProjectsWithLoad>>,
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  priorPlannedHoursByProject: Map<string, number> = new Map(),
  options: {
    priorPlannedHoursByTask?: Map<string, number>;
    priorPlannedEndByProject?: Map<string, Date>;
  } = {},
): ActiveProjectRow[] {
  const assignedByProject = buildAssignedByProject(planning);
  const assignedThisWeekByTask = buildAssignedHoursByTaskId(planning);
  const plannedEndThisWeekByProject = buildPlannedEndByProjectFromPlanning(planning);
  const priorPlannedHoursByTask = options.priorPlannedHoursByTask ?? new Map();
  const priorPlannedEndByProject = options.priorPlannedEndByProject ?? new Map();

  const rows: ActiveProjectRow[] = [];

  for (const p of projects) {
    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const openTasks = p.tasks.filter(
      (t) => !t.isCompleted && Math.max(0, t.estimatedHours - t.doneHours) > 1e-6,
    );
    const remainingWorkHours = openTasks.reduce(
      (acc, t) => acc + Math.max(0, t.estimatedHours - t.doneHours),
      0,
    );
    if (remainingWorkHours <= 0) continue;

    const assignedThisWeek = assignedByProject.get(p.id) ?? 0;
    const priorPlannedHours = priorPlannedHoursByProject.get(p.id) ?? 0;
    const lastPlannedDate =
      [priorPlannedEndByProject.get(p.id), plannedEndThisWeekByProject.get(p.id)]
        .filter((d): d is Date => d != null)
        .reduce<Date | null>(
          (max, d) => (!max || d > max ? d : max),
          null,
        );

    const weekMetrics = aggregateWeekTaskMetrics(
      openTasks.map((t) => {
        const priorTask = priorPlannedHoursByTask.get(t.id) ?? 0;
        const assignedTask = assignedThisWeekByTask.get(t.id) ?? 0;
        const pendingToPlan = pendingToPlanHoursForTask(
          t,
          priorPlannedHoursByTask,
          assignedThisWeekByTask,
        );
        return computeWeekTaskMetrics({
          estimatedHours: t.estimatedHours,
          doneHours: t.doneHours,
          priorPlannedHours: priorTask,
          assignedThisWeekHours: assignedTask,
          pendingHours: pendingToPlan,
        });
      }),
    );

    const progress = computeWeekProgress({
      estimatedHours,
      doneHours,
      priorPlannedHours,
      assignedThisWeekHours: assignedThisWeek,
    });

    const pendingProcesses = pendingProcessesForProject(
      openTasks.map((task) => {
        const pendingToPlan = pendingToPlanHoursForTask(
          task,
          priorPlannedHoursByTask,
          assignedThisWeekByTask,
        );
        const remaining = Math.max(0, task.estimatedHours - task.doneHours);
        return {
          ...task,
          pendingToPlanHours: pendingToPlan,
          remainingWorkHours: remaining,
        };
      }),
    );

    rows.push({
      projectId: p.id,
      name: p.name,
      code: p.code,
      planningPreset: p.planningPreset,
      planningCostPriority: p.planningCostPriority,
      planningStability: p.planningStability,
      planningDeadlineBoost: p.planningDeadlineBoost,
      deliveryDate: p.deliveryDate,
      estimatedHours,
      doneHours,
      pendingHours: weekMetrics.pendingHours,
      remainingWorkHours,
      weekScopeHours: weekMetrics.weekScopeHours,
      assignedThisWeek,
      progressPct: progress.progressBasePct,
      expectedProgressPct: progress.progressEndPct,
      risk: riskFromPlannedEnd(p.deliveryDate, lastPlannedDate),
      daysLeft: daysUntil(p.deliveryDate),
      expectedCompletion: lastPlannedDate,
      pendingProcesses,
    });
  }

  rows.sort((a, b) => {
    const dateA = a.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const dateB = b.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (dateA !== dateB) return dateA - dateB;
    return b.remainingWorkHours - a.remainingWorkHours;
  });

  return rows;
}

export interface UnassignedProjectRow {
  projectId: string;
  name: string;
  code: string;
  planningPreset: "A_TIEMPO" | "EQUILIBRADO" | "MIN_COSTE";
  planningCostPriority: number;
  planningStability: number;
  planningDeadlineBoost: number;
  deliveryDate: Date | null;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  remainingWorkHours: number;
  weekScopeHours: number;
  assignedThisWeek: number;
  progressPct: number;
  expectedProgressPct?: number;
  risk: ReturnType<typeof riskFromDelivery>;
  daysLeft: number | null;
  pendingProcesses: string[];
}

/** Proyectos con trabajo pendiente no cubierto (o sin horas) en el planning de la semana. */
export function summarizeUnassignedProjects(
  projects: Awaited<ReturnType<typeof getActiveProjectsWithLoad>>,
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  priorPlannedHoursByProject: Map<string, number> = new Map(),
  options: {
    priorPlannedHoursByTask?: Map<string, number>;
  } = {},
): UnassignedProjectRow[] {
  const assignedByProject = buildAssignedByProject(planning);
  const assignedThisWeekByTask = buildAssignedHoursByTaskId(planning);
  const priorPlannedHoursByTask = options.priorPlannedHoursByTask ?? new Map();
  const rows: UnassignedProjectRow[] = [];

  for (const p of projects) {
    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const openTasks = p.tasks.filter(
      (t) => !t.isCompleted && Math.max(0, t.estimatedHours - t.doneHours) > 1e-6,
    );
    const remainingWorkHours = openTasks.reduce(
      (acc, t) => acc + Math.max(0, t.estimatedHours - t.doneHours),
      0,
    );
    if (remainingWorkHours <= 0) continue;

    const assignedThisWeek = assignedByProject.get(p.id) ?? 0;
    const priorPlannedHours = priorPlannedHoursByProject.get(p.id) ?? 0;
    const progress = computeWeekProgress({
      estimatedHours,
      doneHours,
      priorPlannedHours,
      assignedThisWeekHours: assignedThisWeek,
    });

    // Ya planificado al cierre de semanas anteriores (incl. borradores).
    if (progress.progressBasePct >= 100) continue;

    const pendingHours = openTasks.reduce(
      (acc, t) =>
        acc +
        pendingToPlanHoursForTask(t, priorPlannedHoursByTask, assignedThisWeekByTask),
      0,
    );
    if (pendingHours <= 1e-6 && assignedThisWeek <= 1e-6) continue;

    const hasPlanning = planning != null;
    if (hasPlanning && assignedThisWeek > 0) continue;

    const weekScopeHours = pendingHours + assignedThisWeek;

    const pendingProcesses = pendingProcessesForProject(
      openTasks.map((task) => {
        const pendingToPlan = pendingToPlanHoursForTask(
          task,
          priorPlannedHoursByTask,
          assignedThisWeekByTask,
        );
        const remaining = Math.max(0, task.estimatedHours - task.doneHours);
        return {
          ...task,
          pendingToPlanHours: pendingToPlan,
          remainingWorkHours: remaining,
        };
      }),
    );

    rows.push({
      projectId: p.id,
      name: p.name,
      code: p.code,
      planningPreset: p.planningPreset,
      planningCostPriority: p.planningCostPriority,
      planningStability: p.planningStability,
      planningDeadlineBoost: p.planningDeadlineBoost,
      deliveryDate: p.deliveryDate,
      estimatedHours,
      doneHours,
      pendingHours,
      remainingWorkHours,
      weekScopeHours,
      assignedThisWeek,
      progressPct: progress.progressBasePct,
      expectedProgressPct: progress.progressEndPct,
      risk: riskFromDelivery(p.deliveryDate),
      daysLeft: daysUntil(p.deliveryDate),
      pendingProcesses,
    });
  }

  rows.sort((a, b) => {
    const dateA = a.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const dateB = b.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (dateA !== dateB) return dateA - dateB;
    return b.remainingWorkHours - a.remainingWorkHours;
  });

  return rows;
}

export function mergeHoursByDay(...sources: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const source of sources) {
    for (const [day, hours] of source) {
      merged.set(day, (merged.get(day) ?? 0) + hours);
    }
  }
  return merged;
}

export function sumPlannedHoursByDay(
  assignments: { date: Date; hours: number }[],
): { totalHours: number; byDay: Map<string, number> } {
  const byDay = new Map<string, number>();
  let totalHours = 0;
  for (const assignment of assignments) {
    totalHours += assignment.hours;
    const dayKey = assignment.date.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + assignment.hours);
  }
  return { totalHours, byDay };
}

/** Horas planificadas (borrador o publicado) en otras naves para el equipo visible. */
export async function getCrossNavePlanningHoursForWeek({
  naveScope,
  weekStart,
  personIds,
}: {
  naveScope: string[] | null;
  weekStart: Date;
  personIds: string[];
}): Promise<{ totalHours: number; byDay: Map<string, number> }> {
  if (naveScope === null || naveScope.length === 0 || personIds.length === 0) {
    return { totalHours: 0, byDay: new Map() };
  }
  const monday = getMondayOf(weekStart);
  const { year, week } = isoWeek(monday);
  const assignments = await prisma.planningAssignment.findMany({
    where: {
      personId: { in: personIds },
      planning: {
        year,
        week,
        naveId: { notIn: naveScope },
      },
    },
    select: { date: true, hours: true },
  });
  return sumPlannedHoursByDay(assignments);
}

export function summarizePlanning(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
) {
  if (!planning) {
    return {
      totalHours: 0,
      byDay: new Map<string, number>(),
      byPerson: new Map<string, number>(),
    };
  }
  const byDay = new Map<string, number>();
  const byPerson = new Map<string, number>();
  let total = 0;
  for (const a of planning.assignments) {
    total += a.hours;
    const dayKey = a.date.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + a.hours);
    byPerson.set(a.personId, (byPerson.get(a.personId) ?? 0) + a.hours);
  }
  return { totalHours: total, byDay, byPerson };
}

export interface PlanningRangeAssignment {
  id: string;
  date: Date;
  hours: number;
  personId: string;
  process: string;
  person: {
    id: string;
    iniciales: string;
    color: string;
  };
  task: {
    id: string;
    projectId: string;
    project: { name: string };
  };
}

export interface DayTaskHours {
  taskId: string;
  process: string;
  personIniciales: string;
  hours: number;
}

export interface DayProjectDetail {
  id: string;
  name: string;
  hours: number;
  tasks: DayTaskHours[];
}

export interface DayPlanningSummary {
  totalHours: number;
  assignmentCount: number;
  people: Array<{ id: string; iniciales: string; color: string }>;
  peopleHours: Array<{ id: string; iniciales: string; color: string; hours: number }>;
  projectCount: number;
  topProjects: Array<{ id: string; name: string; hours: number }>;
  projects: DayProjectDetail[];
  processes: string[];
  processHours: Array<{ process: string; hours: number }>;
}

export interface MonthPlanningStats {
  totalHours: number;
  plannedDays: number;
  businessDays: number;
  peopleCount: number;
  projectCount: number;
  weeksWithPlanning: number;
  calendarWeeks: number;
}

export interface WeekRowSummary {
  weekMondayIso: string;
  weekNumber: number;
  year: number;
  totalHours: number;
  status: PlanningStatus | null;
}

interface DayWorkSlice {
  dateIso: string;
  hours: number;
  personId: string;
  person: { id: string; iniciales: string; color: string };
  projectId: string;
  projectName: string;
  process: string;
  taskId: string;
}

function buildDaySummaries(
  slices: ReadonlyArray<DayWorkSlice>,
): Map<string, DayPlanningSummary> {
  const byDay = new Map<string, DayPlanningSummary>();

  for (const slice of slices) {
    let summary = byDay.get(slice.dateIso);
    if (!summary) {
      summary = {
        totalHours: 0,
        assignmentCount: 0,
        people: [],
        peopleHours: [],
        projectCount: 0,
        topProjects: [],
        projects: [],
        processes: [],
        processHours: [],
      };
      byDay.set(slice.dateIso, summary);
    }
    summary.totalHours += slice.hours;
    summary.assignmentCount += 1;

    if (!summary.people.some((p) => p.id === slice.personId)) {
      summary.people.push(slice.person);
    }
    if (!summary.processes.includes(slice.process)) {
      summary.processes.push(slice.process);
    }
  }

  for (const [iso, summary] of byDay) {
    const daySlices = slices.filter((s) => s.dateIso === iso);
    const projectIds = new Set(daySlices.map((s) => s.projectId));
    summary.projectCount = projectIds.size;

    const hoursByProject = new Map<
      string,
      {
        id: string;
        name: string;
        hours: number;
        tasks: Map<string, DayTaskHours>;
      }
    >();
    const hoursByPerson = new Map<
      string,
      { id: string; iniciales: string; color: string; hours: number }
    >();
    const hoursByProcess = new Map<string, number>();

    for (const s of daySlices) {
      let project = hoursByProject.get(s.projectId);
      if (!project) {
        project = {
          id: s.projectId,
          name: s.projectName,
          hours: 0,
          tasks: new Map(),
        };
        hoursByProject.set(s.projectId, project);
      }
      project.hours += s.hours;

      const taskKey = `${s.taskId}:${s.personId}`;
      const existingTask = project.tasks.get(taskKey);
      if (existingTask) {
        existingTask.hours += s.hours;
      } else {
        project.tasks.set(taskKey, {
          taskId: s.taskId,
          process: s.process,
          personIniciales: s.person.iniciales,
          hours: s.hours,
        });
      }

      const existingPerson = hoursByPerson.get(s.personId);
      if (existingPerson) {
        existingPerson.hours += s.hours;
      } else {
        hoursByPerson.set(s.personId, {
          id: s.person.id,
          iniciales: s.person.iniciales,
          color: s.person.color,
          hours: s.hours,
        });
      }

      hoursByProcess.set(s.process, (hoursByProcess.get(s.process) ?? 0) + s.hours);
    }

    summary.projects = [...hoursByProject.values()]
      .map((project) => ({
        id: project.id,
        name: project.name,
        hours: project.hours,
        tasks: [...project.tasks.values()].sort((a, b) => b.hours - a.hours),
      }))
      .sort((a, b) => b.hours - a.hours);
    summary.topProjects = summary.projects
      .slice(0, 2)
      .map(({ id, name, hours }) => ({ id, name, hours }));
    summary.peopleHours = [...hoursByPerson.values()].sort((a, b) => b.hours - a.hours);
    summary.processHours = [...hoursByProcess.entries()]
      .map(([process, hours]) => ({ process, hours }))
      .sort((a, b) => b.hours - a.hours);
    summary.processes = summary.processHours.map((p) => p.process);
    byDay.set(iso, summary);
  }

  return byDay;
}

export function summarizeMonthFromDaySummaries(args: {
  summariesByDay: Map<string, DayPlanningSummary>;
  businessDays: number;
  calendarWeeks: number;
  weeksWithPlanning: number;
  projectCount: number;
}): MonthPlanningStats {
  let totalHours = 0;
  let plannedDays = 0;
  const people = new Set<string>();

  for (const summary of args.summariesByDay.values()) {
    if (summary.totalHours <= 0) continue;
    plannedDays += 1;
    totalHours += summary.totalHours;
    for (const p of summary.people) people.add(p.id);
  }

  return {
    totalHours,
    plannedDays,
    businessDays: args.businessDays,
    peopleCount: people.size,
    projectCount: args.projectCount,
    weeksWithPlanning: args.weeksWithPlanning,
    calendarWeeks: args.calendarWeeks,
  };
}

export function countDistinctProjectsInAssignments(
  assignments: ReadonlyArray<{ task: { projectId: string } }>,
): number {
  return new Set(assignments.map((a) => a.task.projectId)).size;
}

export function countDistinctProjectsInActualEntries(
  entries: ReadonlyArray<{ project: { id: string } | null; task: { projectId: string } | null }>,
): number {
  const ids = new Set<string>();
  for (const e of entries) {
    const id = e.project?.id ?? e.task?.projectId;
    if (id) ids.add(id);
  }
  return ids.size;
}

export function summarizeWeekRowsFromCalendar(
  weeks: Array<Array<{ iso: string } | null>>,
  summariesByDay: Map<string, DayPlanningSummary>,
  plannings: Array<{ weekStart: Date; status: PlanningStatus }> = [],
): Map<string, WeekRowSummary> {
  const planningByMonday = new Map<string, PlanningStatus>();
  for (const planning of plannings) {
    const iso = getMondayOf(planning.weekStart).toISOString().slice(0, 10);
    planningByMonday.set(iso, planning.status);
  }

  const byMonday = new Map<string, WeekRowSummary>();

  for (const week of weeks) {
    let weekMondayIso: string | null = null;
    let totalHours = 0;

    for (const cell of week) {
      if (!cell) continue;
      if (!weekMondayIso) {
        weekMondayIso = getMondayOf(new Date(`${cell.iso}T00:00:00.000Z`))
          .toISOString()
          .slice(0, 10);
      }
      totalHours += summariesByDay.get(cell.iso)?.totalHours ?? 0;
    }

    if (!weekMondayIso) continue;

    const monday = getMondayOf(new Date(`${weekMondayIso}T00:00:00.000Z`));
    const { year, week: weekNumber } = isoWeek(monday);
    byMonday.set(weekMondayIso, {
      weekMondayIso,
      weekNumber,
      year,
      totalHours,
      status: planningByMonday.get(weekMondayIso) ?? null,
    });
  }

  for (const planning of plannings) {
    const weekMondayIso = getMondayOf(planning.weekStart).toISOString().slice(0, 10);
    if (byMonday.has(weekMondayIso)) continue;
    const { year, week: weekNumber } = isoWeek(planning.weekStart);
    byMonday.set(weekMondayIso, {
      weekMondayIso,
      weekNumber,
      year,
      totalHours: 0,
      status: planning.status,
    });
  }

  return byMonday;
}

export async function getPlanningForDateRange({
  naveScope,
  rangeStart,
  rangeEnd,
  viewMode = "published_only",
}: {
  naveScope: string[] | null;
  rangeStart: Date;
  rangeEnd: Date;
  viewMode?: PlanningViewMode;
}): Promise<PlanningRangeAssignment[]> {
  if (naveScope !== null && naveScope.length === 0) return [];
  const naveIn = naveScope !== null ? { in: naveScope } : undefined;
  const planningStatus =
    viewMode === "published_only"
      ? { status: PlanningStatus.PUBLISHED }
      : {};

  const rows = await prisma.planningAssignment.findMany({
    where: {
      date: { gte: rangeStart, lte: rangeEnd },
      ...(naveIn
        ? { planning: { naveId: naveIn, ...planningStatus } }
        : { planning: planningStatus }),
    },
    select: {
      id: true,
      date: true,
      hours: true,
      personId: true,
      process: true,
      person: {
        select: { id: true, iniciales: true, color: true },
      },
      task: {
        select: {
          id: true,
          projectId: true,
          project: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { startSlot: "asc" }],
  });

  return rows;
}

export async function getPlanningsInDateRange({
  naveScope,
  rangeStart,
  rangeEnd,
  viewMode = "published_only",
}: {
  naveScope: string[] | null;
  rangeStart: Date;
  rangeEnd: Date;
  viewMode?: PlanningViewMode;
}): Promise<Array<{ weekStart: Date; status: PlanningStatus }>> {
  if (naveScope !== null && naveScope.length === 0) return [];
  const naveIn = naveScope !== null ? { in: naveScope } : undefined;
  const planningStatus =
    viewMode === "published_only"
      ? { status: PlanningStatus.PUBLISHED }
      : {};

  return prisma.planning.findMany({
    where: {
      weekStart: { lte: rangeEnd },
      weekEnd: { gte: rangeStart },
      ...(naveIn ? { naveId: naveIn } : {}),
      ...planningStatus,
    },
    select: { weekStart: true, status: true },
    orderBy: { weekStart: "asc" },
  });
}

export async function getActualHoursForDateRange({
  naveScope,
  rangeStart,
  rangeEnd,
  userId,
}: {
  naveScope: string[] | null;
  rangeStart: Date;
  rangeEnd: Date;
  userId?: string;
}): Promise<ActualHourEntry[]> {
  if (naveScope !== null && naveScope.length === 0) return [];

  const rangeEndExclusive = new Date(rangeEnd.getTime() + 86_400_000);

  const entries = await prisma.timeEntry.findMany({
    where: {
      ...(userId ? { userId } : {}),
      startedAt: { gte: rangeStart, lt: rangeEndExclusive },
      OR: [
        { endedAt: { not: null }, hours: { gt: 0 } },
        { endedAt: null },
      ],
      user: {
        personId: { not: null },
        ...(naveScope !== null
          ? { person: { personNaves: { some: { naveId: { in: naveScope } } } } }
          : {}),
      },
    },
    include: {
      user: { include: { person: { include: { user: { select: { name: true } } } } } },
      project: { select: { id: true, name: true } },
      lamp: { select: { id: true, name: true } },
      task: {
        select: {
          id: true,
          process: true,
          projectId: true,
          lampId: true,
          isCompleted: true,
          lampElement: {
            select: { label: true, elementType: { select: { name: true } } },
          },
          lamp: { select: { elementType: { select: { name: true } } } },
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  const startIso = rangeStart.toISOString().slice(0, 10);
  const endIso = rangeEnd.toISOString().slice(0, 10);
  const mapped: ActualHourEntry[] = [];

  for (const e of entries) {
    const date = e.startedAt.toISOString().slice(0, 10);
    if (date < startIso || date > endIso) continue;

    const endedAt = e.endedAt ?? null;
    const isRunning = endedAt == null;
    const hours = resolveTimeEntryHours(e);
    if (hours <= 0 || !e.user.person) continue;

    mapped.push({
      id: e.id,
      userId: e.userId,
      date,
      startedAt: e.startedAt,
      endedAt,
      hours,
      isRunning,
      process: e.process,
      notes: e.notes,
      personId: e.user.personId,
      person: {
        id: e.user.person.id,
        nombre: e.user.person.user?.name ?? e.user.person.iniciales,
        iniciales: e.user.person.iniciales,
        color: e.user.person.color,
      },
      taskId: e.taskId,
      task: e.task
        ? {
            id: e.task.id,
            process: e.task.process,
            projectId: e.task.projectId,
            lampId: e.task.lampId,
            isCompleted: e.task.isCompleted,
            lampElement: e.task.lampElement,
            lamp: e.task.lamp,
          }
        : null,
      project: e.project,
      lamp: e.lamp,
    });
  }

  return mapped;
}

export function summarizePlanningByDay(
  assignments: ReadonlyArray<PlanningRangeAssignment>,
): Map<string, DayPlanningSummary> {
  return buildDaySummaries(
    assignments.map((a) => ({
      dateIso: a.date.toISOString().slice(0, 10),
      hours: a.hours,
      personId: a.personId,
      person: a.person,
      projectId: a.task.projectId,
      projectName: a.task.project.name,
      process: a.process,
      taskId: a.task.id,
    })),
  );
}

export function summarizeActualByDay(
  entries: ReadonlyArray<ActualHourEntry>,
): Map<string, DayPlanningSummary> {
  return buildDaySummaries(
    entries
      .filter((e) => e.person != null && e.hours > 0)
      .map((e) => ({
        dateIso: e.date,
        hours: e.hours,
        personId: e.person!.id,
        person: {
          id: e.person!.id,
          iniciales: e.person!.iniciales,
          color: e.person!.color,
        },
        projectId: e.project?.id ?? e.task?.projectId ?? e.id,
        projectName: e.project?.name ?? "Sin proyecto",
        process: e.process ?? e.task?.process ?? "—",
        taskId: e.taskId ?? e.task?.id ?? `${e.id}-task`,
      })),
  );
}

export { DAY_MS };
