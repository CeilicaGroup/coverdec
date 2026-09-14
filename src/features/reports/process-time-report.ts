import { prisma } from "@/lib/db";
import { resolveTimeEntryHours } from "@/features/time-tracking/entry-hours";
import { loadPrimaryWorkerByTaskIds } from "@/features/time-tracking/task-hours-derived";

export interface ProcessTimeReportFilters {
  projectId?: string;
  lampId?: string;
  elementTypeId?: string;
  personId?: string;
}

export interface ProcessTimeReportRow {
  taskId: string;
  projectId: string;
  projectName: string;
  lampId: string;
  lampName: string;
  frameTypeName: string;
  process: string;
  processLabel: string;
  responsableName: string | null;
  estimatedHours: number;
  realHours: number;
  deviationPct: number | null;
  completedAt: Date;
}

export interface ProcessTimeReportSummaryRow {
  frameTypeName: string;
  process: string;
  processLabel: string;
  sampleCount: number;
  avgEstimatedHours: number;
  avgRealHours: number;
}

function deviationPct(estimated: number, real: number): number | null {
  if (estimated <= 1e-6) return null;
  return ((real - estimated) / estimated) * 100;
}

export async function loadProcessTimeReport(
  filters: ProcessTimeReportFilters,
): Promise<{ rows: ProcessTimeReportRow[]; summary: ProcessTimeReportSummaryRow[] }> {
  const tasks = await prisma.task.findMany({
    where: {
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.lampId ? { lampId: filters.lampId } : {}),
      ...(filters.elementTypeId ? { lamp: { elementTypeId: filters.elementTypeId } } : {}),
      ...(filters.personId
        ? { timeEntries: { some: { user: { personId: filters.personId } } } }
        : {}),
      timeEntries: { some: {} },
    },
    select: {
      id: true,
      projectId: true,
      lampId: true,
      process: true,
      estimatedHours: true,
      updatedAt: true,
      project: { select: { name: true } },
      lamp: { select: { name: true, elementType: { select: { name: true } } } },
      processDefinition: { select: { label: true } },
      timeEntries: {
        where: { endedAt: { not: null }, hours: { gt: 0 } },
        select: { startedAt: true, endedAt: true, hours: true },
      },
    },
    orderBy: [{ project: { name: "asc" } }, { lamp: { name: "asc" } }, { order: "asc" }],
  });

  const responsableByTaskId = await loadPrimaryWorkerByTaskIds(
    prisma,
    tasks.map((t) => t.id),
  );
  const personIds = [...new Set([...responsableByTaskId.values()])];
  const persons = personIds.length
    ? await prisma.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, alias: true, iniciales: true },
      })
    : [];
  const personNameById = new Map(
    persons.map((p) => [p.id, p.alias ?? p.iniciales]),
  );

  const rows: ProcessTimeReportRow[] = tasks.map((task) => {
    const realHours = task.timeEntries.reduce(
      (sum, e) => sum + resolveTimeEntryHours(e),
      0,
    );
    const responsableId = responsableByTaskId.get(task.id) ?? null;
    let latestEnd = task.updatedAt;
    for (const entry of task.timeEntries) {
      if (entry.endedAt && entry.endedAt.getTime() > latestEnd.getTime()) {
        latestEnd = entry.endedAt;
      }
    }
    return {
      taskId: task.id,
      projectId: task.projectId,
      projectName: task.project.name,
      lampId: task.lampId,
      lampName: task.lamp.name,
      frameTypeName: task.lamp.elementType?.name ?? "—",
      process: task.process,
      processLabel: task.processDefinition.label,
      responsableName: responsableId ? (personNameById.get(responsableId) ?? null) : null,
      estimatedHours: task.estimatedHours,
      realHours,
      deviationPct: deviationPct(task.estimatedHours, realHours),
      completedAt: latestEnd,
    };
  });

  const groups = new Map<
    string,
    { frameTypeName: string; process: string; processLabel: string; estimated: number[]; real: number[] }
  >();
  for (const row of rows) {
    const key = `${row.frameTypeName}:${row.process}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        frameTypeName: row.frameTypeName,
        process: row.process,
        processLabel: row.processLabel,
        estimated: [],
        real: [],
      };
      groups.set(key, group);
    }
    group.estimated.push(row.estimatedHours);
    group.real.push(row.realHours);
  }
  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const summary: ProcessTimeReportSummaryRow[] = [...groups.values()]
    .map((g) => ({
      frameTypeName: g.frameTypeName,
      process: g.process,
      processLabel: g.processLabel,
      sampleCount: g.estimated.length,
      avgEstimatedHours: avg(g.estimated),
      avgRealHours: avg(g.real),
    }))
    .sort(
      (a, b) =>
        a.frameTypeName.localeCompare(b.frameTypeName) || a.processLabel.localeCompare(b.processLabel),
    );

  return { rows, summary };
}

export interface ProcessTimeReportFilterOptions {
  projects: { id: string; name: string }[];
  lamps: { id: string; name: string }[];
  frameTypes: { id: string; name: string }[];
  persons: { id: string; name: string }[];
}

export async function loadReportFilterOptions(
  projectId: string | undefined,
): Promise<ProcessTimeReportFilterOptions> {
  const [projects, lamps, frameTypes, persons] = await Promise.all([
    prisma.project.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    projectId
      ? prisma.lamp.findMany({
          where: { projectId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.elementType.findMany({
      where: { typology: "BASTIDOR", isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.person.findMany({
      where: { isActive: true },
      select: { id: true, alias: true, iniciales: true },
      orderBy: { iniciales: "asc" },
    }),
  ]);

  return {
    projects,
    lamps,
    frameTypes,
    persons: persons.map((p) => ({ id: p.id, name: p.alias ?? p.iniciales })),
  };
}
