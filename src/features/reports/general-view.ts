import { prisma } from "@/lib/db";
import { isProjectFinished } from "@/lib/project-status";
import { aggregateTasksByProcess } from "@/features/projects/lamp-tasks";
import {
  computeTaskHourTotals,
  loadDoneHoursByTaskIds,
  resolveTaskDoneHours,
} from "@/features/time-tracking/task-hours-derived";
import type { ProcessCode } from "@/types/process";

/**
 * Vista General (RE-01): plan vs real por proyecto → lámpara → proceso,
 * equivalente a la hoja «Proyectos» del Excel de producción del cliente.
 * Plan = Task.estimatedHours (catálogo × medida); real = fichajes.
 */

export type GeneralViewStatus = "PENDIENTE" | "EN_CURSO" | "TERMINADO";

export const GENERAL_VIEW_STATUS_LABELS: Record<GeneralViewStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_CURSO: "En curso",
  TERMINADO: "Terminado",
};

export interface GeneralViewTaskInput {
  id: string;
  process: ProcessCode;
  estimatedHours: number;
  isCompleted: boolean;
  order: number;
  projectId: string;
  projectName: string;
  deliveryDate: Date | null;
  lampId: string;
  lampName: string;
  frameTypeName: string;
  surfaceM2: number | null;
}

export interface GeneralViewTotals {
  planHours: number;
  realHours: number;
  pendingHours: number;
  /** (real − plan) / plan × 100; null si no hay plan. Mismo signo que «Tiempos por proceso». */
  deviationPct: number | null;
  /** Avance acreditado (tarea completada = 100 % de su plan), 0–100. */
  progressPct: number;
}

export interface GeneralViewRow extends GeneralViewTotals {
  key: string;
  lampId: string;
  lampName: string;
  frameTypeName: string;
  surfaceM2: number | null;
  process: ProcessCode;
  units: number;
  status: GeneralViewStatus;
}

export interface GeneralViewProject {
  projectId: string;
  projectName: string;
  deliveryDate: Date | null;
  rows: GeneralViewRow[];
  totals: GeneralViewTotals;
}

export interface GeneralView {
  projects: GeneralViewProject[];
  totals: GeneralViewTotals;
}

function buildTotals(planHours: number, realHours: number, creditedHours: number): GeneralViewTotals {
  return {
    planHours,
    realHours,
    pendingHours: Math.max(0, planHours - realHours),
    deviationPct: planHours > 1e-6 ? ((realHours - planHours) / planHours) * 100 : null,
    progressPct:
      planHours > 1e-6 ? Math.min(100, (creditedHours / planHours) * 100) : creditedHours > 0 ? 100 : 0,
  };
}

function sumTotals(items: Array<GeneralViewTotals & { creditedHours: number }>): GeneralViewTotals {
  let plan = 0;
  let real = 0;
  let credited = 0;
  for (const item of items) {
    plan += item.planHours;
    real += item.realHours;
    credited += item.creditedHours;
  }
  return buildTotals(plan, real, credited);
}

export function buildGeneralView(
  tasks: GeneralViewTaskInput[],
  doneByTaskId: Map<string, number>,
): GeneralView {
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // proyecto → (lámpara + bastidor) → tareas, en el orden de entrada
  const byProject = new Map<string, { first: GeneralViewTaskInput; groups: Map<string, GeneralViewTaskInput[]> }>();
  for (const task of tasks) {
    const project = byProject.get(task.projectId) ?? { first: task, groups: new Map() };
    const groupKey = `${task.lampId}:${task.frameTypeName}`;
    const list = project.groups.get(groupKey) ?? [];
    list.push(task);
    project.groups.set(groupKey, list);
    byProject.set(task.projectId, project);
  }

  const allRows: Array<GeneralViewRow & { creditedHours: number }> = [];
  const projects: GeneralViewProject[] = [];

  for (const { first, groups } of byProject.values()) {
    const projectRows: Array<GeneralViewRow & { creditedHours: number }> = [];
    for (const [groupKey, groupTasks] of groups) {
      const lamp = groupTasks[0]!;
      const aggregates = aggregateTasksByProcess(
        groupTasks.map((t) => {
          const { doneHours, remainingWorkHours } = computeTaskHourTotals(
            t.estimatedHours,
            doneByTaskId.get(t.id) ?? 0,
          );
          return { ...t, doneHours, pendingHours: remainingWorkHours };
        }),
      );
      for (const agg of aggregates) {
        const aggTasks = agg.taskIds.map((id) => taskById.get(id)!);
        const creditedHours = aggTasks.reduce(
          (sum, t) =>
            sum +
            resolveTaskDoneHours({
              estimatedHours: t.estimatedHours,
              doneHours: doneByTaskId.get(t.id) ?? 0,
              isCompleted: t.isCompleted,
            }),
          0,
        );
        const status: GeneralViewStatus = aggTasks.every((t) => t.isCompleted)
          ? "TERMINADO"
          : agg.doneHours > 0 || aggTasks.some((t) => t.isCompleted)
            ? "EN_CURSO"
            : "PENDIENTE";
        projectRows.push({
          key: `${groupKey}:${agg.process}`,
          lampId: lamp.lampId,
          lampName: lamp.lampName,
          frameTypeName: lamp.frameTypeName,
          surfaceM2: lamp.surfaceM2,
          process: agg.process,
          units: agg.units,
          status,
          creditedHours,
          ...buildTotals(agg.estimatedHours, agg.doneHours, creditedHours),
          ...(status === "TERMINADO" ? { progressPct: 100 } : {}),
        });
      }
    }
    allRows.push(...projectRows);
    projects.push({
      projectId: first.projectId,
      projectName: first.projectName,
      deliveryDate: first.deliveryDate,
      rows: projectRows.map(({ creditedHours: _credited, ...row }) => row),
      totals: sumTotals(projectRows),
    });
  }

  // Por fecha de entrega (sin fecha al final), luego nombre.
  projects.sort(
    (a, b) =>
      (a.deliveryDate?.getTime() ?? Infinity) - (b.deliveryDate?.getTime() ?? Infinity) ||
      a.projectName.localeCompare(b.projectName),
  );

  return { projects, totals: sumTotals(allRows) };
}

export interface GeneralViewFilters {
  /** null = todas las naves; [] = ninguna. */
  naveScope: string[] | null;
  projectId?: string;
  includeFinished: boolean;
}

export async function loadGeneralView(filters: GeneralViewFilters): Promise<GeneralView> {
  if (filters.naveScope !== null && filters.naveScope.length === 0) {
    return buildGeneralView([], new Map());
  }

  const tasks = await prisma.task.findMany({
    where: {
      ...(filters.naveScope !== null ? { naveId: { in: filters.naveScope } } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      project: { isActive: true, kind: { notIn: ["STOCK", "IMPREVISTAS"] } },
    },
    select: {
      id: true,
      process: true,
      estimatedHours: true,
      isCompleted: true,
      order: true,
      project: { select: { id: true, name: true, deliveryDate: true } },
      lamp: {
        select: {
          id: true,
          name: true,
          code: true,
          surfaceM2: true,
          elementType: { select: { name: true } },
        },
      },
      lampElement: { select: { elementType: { select: { name: true } } } },
    },
    orderBy: [{ lamp: { name: "asc" } }, { order: "asc" }],
  });

  const finishedProjectIds = new Set<string>();
  if (!filters.includeFinished) {
    const byProject = new Map<string, { isCompleted: boolean }[]>();
    for (const t of tasks) {
      const list = byProject.get(t.project.id) ?? [];
      list.push(t);
      byProject.set(t.project.id, list);
    }
    for (const [projectId, projectTasks] of byProject) {
      if (isProjectFinished(projectTasks)) finishedProjectIds.add(projectId);
    }
  }

  const visible = tasks.filter((t) => !finishedProjectIds.has(t.project.id));
  const doneByTaskId = await loadDoneHoursByTaskIds(
    prisma,
    visible.map((t) => t.id),
  );

  return buildGeneralView(
    visible.map((t) => ({
      id: t.id,
      process: t.process,
      estimatedHours: t.estimatedHours,
      isCompleted: t.isCompleted,
      order: t.order,
      projectId: t.project.id,
      projectName: t.project.name,
      deliveryDate: t.project.deliveryDate,
      lampId: t.lamp.id,
      lampName: t.lamp.code ? `${t.lamp.code} · ${t.lamp.name}` : t.lamp.name,
      frameTypeName: t.lampElement?.elementType?.name ?? t.lamp.elementType?.name ?? "—",
      surfaceM2: t.lamp.surfaceM2,
    })),
    doneByTaskId,
  );
}

/** Proyectos para el filtro de la vista General. */
export async function listGeneralViewProjectOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.project.findMany({
    where: { isActive: true, kind: { notIn: ["STOCK", "IMPREVISTAS"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
