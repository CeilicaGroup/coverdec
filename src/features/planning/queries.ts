import { PlanningStatus } from "@/generated/prisma";
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
            lamp: { include: { frameType: { select: { name: true } } } },
            lampFrame: { include: { frameType: { select: { name: true } } } },
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
    lampFrame?: { label: string | null; frameType?: { name: string } | null } | null;
    lamp?: { frameType?: { name: string } | null } | null;
  } | null;
  project: { id: string; name: string } | null;
  lamp: { id: string; name: string } | null;
}

export async function getActualHoursForWeek({
  naveScope,
  weekStart,
}: {
  naveScope: string[] | null;
  weekStart: Date;
}): Promise<ActualHourEntry[]> {
  const monday = getMondayOf(weekStart);
  const saturdayStart = new Date(monday.getTime() + 5 * 86_400_000);

  if (naveScope !== null && naveScope.length === 0) return [];

  const entries = await prisma.timeEntry.findMany({
    where: {
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
          lampFrame: {
            select: { label: true, frameType: { select: { name: true } } },
          },
          lamp: { select: { frameType: { select: { name: true } } } },
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  return entries.map((e) => {
    const endedAt = e.endedAt ?? null;
    const isRunning = endedAt == null;
    const hours = (() => {
      if (typeof e.hours === "number" && e.hours > 0) return e.hours;
      if (!endedAt) {
        return Math.max(0, (Date.now() - e.startedAt.getTime()) / 3600000);
      }
      return Math.max(0, (endedAt.getTime() - e.startedAt.getTime()) / 3600000);
    })();
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
          lampFrame: e.task.lampFrame,
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
    where: { date: { gte: start, lte: end } },
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
          pendingHours: true,
          doneHours: true,
          isCompleted: true,
        },
      },
    },
    orderBy: [
      { deliveryDate: { sort: "asc", nulls: "last" } },
      { name: "asc" },
    ],
  });
  return projects;
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
              frameType: { select: { name: true } },
            },
          },
          lampFrame: {
            select: {
              id: true,
              label: true,
              frameType: { select: { name: true } },
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
              frameType: { select: { name: true } },
            },
          },
          lampFrame: {
            select: {
              id: true,
              label: true,
              frameType: { select: { name: true } },
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
      const hours =
        typeof e.hours === "number" && e.hours > 0
          ? e.hours
          : Math.max(0, (end.getTime() - start.getTime()) / 3600000);
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
          pendingHours: true,
          doneHours: true,
          isCompleted: true,
          lamp: {
            select: {
              id: true,
              name: true,
              frameType: { select: { name: true } },
            },
          },
          lampFrameId: true,
          lampFrame: {
            select: {
              id: true,
              label: true,
              frameType: { select: { name: true } },
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

function pendingProcessesForProject(
  tasks: {
    process: string;
    pendingHours: number;
    estimatedHours: number;
    doneHours: number;
    isCompleted: boolean;
  }[],
): string[] {
  return Array.from(
    new Set(
      tasks
        .filter((t) => !isTaskClosedForPlanning(t) && t.pendingHours > 1e-6)
        .map((t) => t.process),
    ),
  );
}

function remainingWorkHoursForProject(
  tasks: {
    estimatedHours: number;
    doneHours: number;
    pendingHours: number;
    isCompleted: boolean;
  }[],
): number {
  return tasks
    .filter((t) => !isTaskClosedForPlanning(t))
    .reduce((acc, t) => acc + Math.max(0, t.estimatedHours - t.doneHours), 0);
}

/** Todos los proyectos activos con carga y proyección de fin. */
export function summarizeAllActiveProjects(
  projects: Awaited<ReturnType<typeof getActiveProjectsWithLoad>>,
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  priorPlannedHoursByProject: Map<string, number> = new Map(),
): ActiveProjectRow[] {
  const assignedByProject = buildAssignedByProject(planning);

  const plannedEndByProject = new Map<string, Date>();
  if (planning) {
    for (const a of planning.assignments) {
      const pid = a.task.projectId;
      const cur = plannedEndByProject.get(pid);
      if (!cur || a.date > cur) plannedEndByProject.set(pid, a.date);
    }
  }

  const rows: ActiveProjectRow[] = [];

  for (const p of projects) {
    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const remainingWorkHours = remainingWorkHoursForProject(p.tasks);
    if (remainingWorkHours <= 0) continue;

    const assignedThisWeek = assignedByProject.get(p.id) ?? 0;
    const priorPlannedHours = priorPlannedHoursByProject.get(p.id) ?? 0;
    const lastPlannedDate = plannedEndByProject.get(p.id) ?? null;

    const weekMetrics = aggregateWeekTaskMetrics(
      p.tasks
        .filter((t) => !isTaskClosedForPlanning(t))
        .map((t) =>
          computeWeekTaskMetrics({
            estimatedHours: t.estimatedHours,
            doneHours: t.doneHours,
            priorPlannedHours: 0,
            assignedThisWeekHours: 0,
            pendingHours: t.pendingHours,
          }),
        ),
    );
    const weekScopeHours = weekMetrics.pendingHours + assignedThisWeek;

    const progress = computeWeekProgress({
      estimatedHours,
      doneHours,
      priorPlannedHours,
      assignedThisWeekHours: assignedThisWeek,
    });

    const pendingProcesses = pendingProcessesForProject(p.tasks);

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
      weekScopeHours,
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
): UnassignedProjectRow[] {
  const assignedByProject = buildAssignedByProject(planning);
  const rows: UnassignedProjectRow[] = [];

  for (const p of projects) {
    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const openTasks = p.tasks.filter((t) => !isTaskClosedForPlanning(t));
    const pendingHours = openTasks.reduce((a, t) => a + t.pendingHours, 0);
    const remainingWorkHours = remainingWorkHoursForProject(p.tasks);
    if (remainingWorkHours <= 0) continue;

    const assignedThisWeek = assignedByProject.get(p.id) ?? 0;
    const hasPlanning = planning != null;

    // Sin planning: todo lo pendiente está sin asignar. Con planning: sin horas esta semana.
    if (hasPlanning && assignedThisWeek > 0) continue;

    const priorPlannedHours = priorPlannedHoursByProject.get(p.id) ?? 0;
    const weekScopeHours = pendingHours + assignedThisWeek;
    const progress = computeWeekProgress({
      estimatedHours,
      doneHours,
      priorPlannedHours,
      assignedThisWeekHours: assignedThisWeek,
    });

    const pendingProcesses = pendingProcessesForProject(p.tasks);

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

export { DAY_MS };
