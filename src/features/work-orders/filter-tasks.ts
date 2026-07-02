import { getTaskLampElementLabel } from "@/features/planning/task-lamp-frame";
import { internalProjectDisplayLabel } from "@/lib/project-kind";

export interface WorkOrderTaskFilterable {
  id: string;
  project: { id: string; name: string; code: string; kind?: string };
  lamp: {
    name: string;
    elementType?: { id: string; name: string } | null;
  };
  lampElement?: {
    label: string | null;
    elementType: { id: string; name: string };
  } | null;
  nave: { id: string; codigo: string; nombre: string };
  process: string;
  processDefinition: { label: string };
  estimatedHours: number;
  notes?: string | null;
}

export interface WorkOrderTaskFilters {
  search?: string;
  projectId?: string;
  processCode?: string;
  naveId?: string;
  elementTypeId?: string;
}

export const EMPTY_WORK_ORDER_TASK_FILTERS: WorkOrderTaskFilters = {};

function elementTypeId(task: WorkOrderTaskFilterable): string | null {
  return (
    task.lampElement?.elementType.id ?? task.lamp.elementType?.id ?? null
  );
}

function elementTypeName(task: WorkOrderTaskFilterable): string | null {
  return (
    task.lampElement?.elementType.name ??
    task.lamp.elementType?.name ??
    null
  );
}

function matchesSearch(task: WorkOrderTaskFilterable, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const element = getTaskLampElementLabel(task);
  const haystack = [
    task.project.name,
    task.project.code,
    task.lamp.name,
    element,
    elementTypeName(task),
    task.processDefinition.label,
    task.process,
    task.nave.codigo,
    task.nave.nombre,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function filterWorkOrderTasks<T extends WorkOrderTaskFilterable>(
  tasks: T[],
  filters: WorkOrderTaskFilters,
): T[] {
  return tasks.filter((task) => {
    if (filters.projectId && task.project.id !== filters.projectId) return false;
    if (filters.processCode && task.process !== filters.processCode) return false;
    if (filters.naveId && task.nave.id !== filters.naveId) return false;
    if (filters.elementTypeId && elementTypeId(task) !== filters.elementTypeId) {
      return false;
    }
    if (!matchesSearch(task, filters.search ?? "")) return false;
    return true;
  });
}

export interface WorkOrderTaskFilterOptions {
  projects: Array<{ id: string; label: string }>;
  processes: Array<{ code: string; label: string }>;
  naves: Array<{ id: string; label: string }>;
  elements: Array<{ id: string; label: string }>;
}

export function buildWorkOrderTaskFilterOptions<T extends WorkOrderTaskFilterable>(
  tasks: T[],
): WorkOrderTaskFilterOptions {
  const projects = new Map<string, string>();
  const processes = new Map<string, string>();
  const naves = new Map<string, string>();
  const elements = new Map<string, string>();

  for (const task of tasks) {
    const projectLabel = internalProjectDisplayLabel(
      task.project.kind,
      task.project.name,
    );
    projects.set(task.project.id, projectLabel);
    processes.set(task.process, task.processDefinition.label);
    naves.set(task.nave.id, task.nave.codigo);
    const etId = elementTypeId(task);
    const etName = elementTypeName(task);
    if (etId && etName) elements.set(etId, etName);
  }

  const sortByLabel = (entries: Map<string, string>) =>
    [...entries.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([id, label]) => ({ id, label }));

  return {
    projects: sortByLabel(projects),
    processes: [...processes.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([code, label]) => ({ code, label })),
    naves: sortByLabel(naves),
    elements: sortByLabel(elements),
  };
}
