import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { isoWeek } from "@/lib/week";
import { daysUntil, riskFromDelivery, riskFromPlannedEnd } from "@/lib/format";
import type { ProcessBadgeStyle } from "@/components/process-badge";
import {
  DEFAULT_PLANNING_WEIGHTS,
  normalizePlanningWeights,
  type PlanningWeights,
} from "@/features/planning/policy-schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getPlanningForWeek({
  naveId,
  weekStart,
}: {
  naveId: string | null;
  weekStart: Date;
}) {
  const monday = getMondayOf(weekStart);
  const { year, week } = isoWeek(monday);
  const include = {
    assignments: {
      include: {
        person: true,
        task: { include: { project: true, lamp: true } },
      },
      orderBy: [{ date: "asc" as const }, { startSlot: "asc" as const }],
    },
  };

  if (naveId !== null) {
    return prisma.planning.findUnique({
      where: { naveId_year_week: { naveId, year, week } },
      include,
    });
  }

  // All naves: merge assignments from every planning this week
  const plannings = await prisma.planning.findMany({ where: { year, week }, include });
  if (plannings.length === 0) return null;

  const allAssignments = plannings
    .flatMap((p) => p.assignments)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot);

  return { ...plannings[0]!, id: "__all__", naveId: "__all__", assignments: allAssignments };
}

export interface ProcessDefinitionInfo {
  waitHours: number;
  badge: ProcessBadgeStyle;
}

export async function getNavePersonnel(naveId: string | null) {
  if (naveId === null) {
    return prisma.person.findMany({
      where: { isActive: true },
      include: { specialties: true },
      orderBy: { iniciales: "asc" },
    });
  }
  const byNave = await prisma.person.findMany({
    where: { naveId, isActive: true },
    include: { specialties: true },
    orderBy: { iniciales: "asc" },
  });
  if (byNave.length > 0) return byNave;
  return prisma.person.findMany({
    where: { isActive: true },
    include: { specialties: true },
    orderBy: { iniciales: "asc" },
  });
}

export interface ActualHourEntry {
  id: string;
  /** ISO date string "YYYY-MM-DD" derived from startedAt UTC */
  date: string;
  startedAt: Date;
  hours: number;
  process: string | null;
  notes: string | null;
  personId: string | null;
  person: { id: string; nombre: string; iniciales: string; color: string } | null;
  project: { id: string; name: string } | null;
  lamp: { id: string; name: string } | null;
}

export async function getActualHoursForWeek({
  naveId,
  weekStart,
}: {
  naveId: string | null;
  weekStart: Date;
}): Promise<ActualHourEntry[]> {
  const monday = getMondayOf(weekStart);
  const saturdayStart = new Date(monday.getTime() + 5 * 86_400_000);

  const entries = await prisma.timeEntry.findMany({
    where: {
      startedAt: { gte: monday, lt: saturdayStart },
      hours: { gt: 0 },
      endedAt: { not: null },
      user: {
        personId: { not: null },
        ...(naveId !== null ? { person: { naveId } } : {}),
      },
    },
    include: {
      user: { include: { person: true } },
      project: { select: { id: true, name: true } },
      lamp: { select: { id: true, name: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  return entries.map((e) => ({
    id: e.id,
    date: e.startedAt.toISOString().slice(0, 10),
    startedAt: e.startedAt,
    hours: e.hours!,
    process: e.process,
    notes: e.notes,
    personId: e.user.personId,
    person: e.user.person
      ? {
          id: e.user.person.id,
          nombre: e.user.person.nombre,
          iniciales: e.user.person.iniciales,
          color: e.user.person.color,
        }
      : null,
    project: e.project,
    lamp: e.lamp,
  }));
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

export async function getActiveProjectsWithLoad(naveId: string | null) {
  const projects = await prisma.project.findMany({
    where: naveId !== null
      ? { isActive: true, tasks: { some: { naveId } } }
      : { isActive: true },
    include: {
      tasks: {
        where: naveId !== null ? { naveId } : undefined,
        select: {
          id: true,
          process: true,
          estimatedHours: true,
          pendingHours: true,
          doneHours: true,
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

export interface ActiveProjectRow {
  projectId: string;
  name: string;
  code: string;
  deliveryDate: Date | null;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  /** Resto de obra (estimado − hecho), independiente del pending del motor de planning. */
  remainingWorkHours: number;
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

/** Todos los proyectos activos con carga y proyección de fin. */
export function summarizeAllActiveProjects(
  projects: Awaited<ReturnType<typeof getActiveProjectsWithLoad>>,
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
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
    const pendingHours = p.tasks.reduce((a, t) => a + t.pendingHours, 0);
    const remainingWorkHours = Math.max(0, estimatedHours - doneHours);
    if (remainingWorkHours <= 0) continue;

    const assignedThisWeek = assignedByProject.get(p.id) ?? 0;
    const lastPlannedDate = plannedEndByProject.get(p.id) ?? null;

    const pendingProcesses = Array.from(
      new Set(
        p.tasks.filter((t) => t.pendingHours > 0 || t.doneHours < t.estimatedHours).map((t) => t.process),
      ),
    );

    rows.push({
      projectId: p.id,
      name: p.name,
      code: p.code,
      deliveryDate: p.deliveryDate,
      estimatedHours,
      doneHours,
      pendingHours,
      remainingWorkHours,
      assignedThisWeek,
      progressPct:
        estimatedHours > 0 ? Math.round((doneHours / estimatedHours) * 100) : 0,
      expectedProgressPct:
        estimatedHours > 0
          ? Math.min(100, Math.round(((doneHours + assignedThisWeek) / estimatedHours) * 100))
          : 0,
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
  deliveryDate: Date | null;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  remainingWorkHours: number;
  assignedThisWeek: number;
  progressPct: number;
  risk: ReturnType<typeof riskFromDelivery>;
  daysLeft: number | null;
  pendingProcesses: string[];
}

/** Proyectos con trabajo pendiente no cubierto (o sin horas) en el planning de la semana. */
export function summarizeUnassignedProjects(
  projects: Awaited<ReturnType<typeof getActiveProjectsWithLoad>>,
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
): UnassignedProjectRow[] {
  const assignedByProject = buildAssignedByProject(planning);
  const rows: UnassignedProjectRow[] = [];

  for (const p of projects) {
    const estimatedHours = p.tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const doneHours = p.tasks.reduce((a, t) => a + t.doneHours, 0);
    const pendingHours = p.tasks.reduce((a, t) => a + t.pendingHours, 0);
    const remainingWorkHours = Math.max(0, estimatedHours - doneHours);
    if (remainingWorkHours <= 0) continue;

    const assignedThisWeek = assignedByProject.get(p.id) ?? 0;
    const hasPlanning = planning != null;

    // Sin planning: todo lo pendiente está sin asignar. Con planning: sin horas esta semana.
    if (hasPlanning && assignedThisWeek > 0) continue;

    const pendingProcesses = Array.from(
      new Set(
        p.tasks.filter((t) => t.pendingHours > 0 || t.doneHours < t.estimatedHours).map((t) => t.process),
      ),
    );

    rows.push({
      projectId: p.id,
      name: p.name,
      code: p.code,
      deliveryDate: p.deliveryDate,
      estimatedHours,
      doneHours,
      pendingHours,
      remainingWorkHours,
      assignedThisWeek,
      progressPct:
        estimatedHours > 0 ? Math.round((doneHours / estimatedHours) * 100) : 0,
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
