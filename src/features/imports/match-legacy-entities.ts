import { normalizeLampName } from "@/features/projects/lamp-name-validation";
import { importSlug } from "./slug";

/** Normalizes free-text labels for fuzzy matching across Excel sheets. */
export function normalizeImportLabel(value: string): string {
  return normalizeLampName(value);
}

export function projectCodeFromName(name: string): string {
  return importSlug(name, 64) || `proj-${Date.now()}`;
}

export interface ElementTypeMatch {
  id: string;
  name: string;
  code: string;
}

export interface ProjectMatch {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export interface LampMatch {
  id: string;
  name: string;
  nameKey: string;
  projectId: string;
}

export interface TaskMatch {
  id: string;
  projectId: string;
  lampId: string;
  process: string;
  lampElementId: string | null;
  areaLabel: string | null;
}

export interface UserMatch {
  id: string;
  name: string;
}

export interface LegacyEntityIndex {
  elementTypesByKey: Map<string, ElementTypeMatch>;
  projectsByKey: Map<string, ProjectMatch>;
  lampsByProjectAndKey: Map<string, LampMatch>;
  tasksByKey: Map<string, TaskMatch[]>;
  usersByKey: Map<string, UserMatch>;
}

export function buildLegacyEntityIndex(input: {
  elementTypes: ElementTypeMatch[];
  projects: (ProjectMatch & { lamps: LampMatch[] })[];
  tasks: TaskMatch[];
  users: UserMatch[];
}): LegacyEntityIndex {
  const elementTypesByKey = new Map<string, ElementTypeMatch>();
  for (const et of input.elementTypes) {
    elementTypesByKey.set(normalizeImportLabel(et.name), et);
    elementTypesByKey.set(normalizeImportLabel(et.code), et);
  }

  const projectsByKey = new Map<string, ProjectMatch>();
  const lampsByProjectAndKey = new Map<string, LampMatch>();
  for (const project of input.projects) {
    projectsByKey.set(normalizeImportLabel(project.name), project);
    projectsByKey.set(normalizeImportLabel(project.code), project);
    for (const lamp of project.lamps) {
      lampsByProjectAndKey.set(
        `${project.id}::${normalizeImportLabel(lamp.nameKey)}`,
        lamp,
      );
      lampsByProjectAndKey.set(
        `${project.id}::${normalizeImportLabel(lamp.name)}`,
        lamp,
      );
    }
  }

  const tasksByKey = new Map<string, TaskMatch[]>();
  for (const task of input.tasks) {
    const key = taskLookupKey({
      projectId: task.projectId,
      lampId: task.lampId,
      process: task.process,
    });
    const list = tasksByKey.get(key) ?? [];
    list.push(task);
    tasksByKey.set(key, list);
  }

  const usersByKey = new Map<string, UserMatch>();
  for (const user of input.users) {
    usersByKey.set(normalizeImportLabel(user.name), user);
  }

  return {
    elementTypesByKey,
    projectsByKey,
    lampsByProjectAndKey,
    tasksByKey,
    usersByKey,
  };
}

export function taskLookupKey(input: {
  projectId: string;
  lampId: string;
  process: string;
}): string {
  return `${input.projectId}::${input.lampId}::${input.process}`;
}

export function matchElementTypeByBastidorName(
  index: LegacyEntityIndex,
  name: string,
): ElementTypeMatch | null {
  const key = normalizeImportLabel(name);
  return index.elementTypesByKey.get(key) ?? null;
}

export function matchProjectByName(
  index: LegacyEntityIndex,
  name: string,
): ProjectMatch | null {
  return index.projectsByKey.get(normalizeImportLabel(name)) ?? null;
}

export function matchLampByName(
  index: LegacyEntityIndex,
  projectId: string,
  lampName: string,
): LampMatch | null {
  const key = normalizeImportLabel(lampName);
  return (
    index.lampsByProjectAndKey.get(`${projectId}::${key}`) ?? null
  );
}

export function matchTask(input: {
  index: LegacyEntityIndex;
  projectId: string;
  lampId: string;
  process: string;
  areaName?: string;
}): TaskMatch | null {
  const key = taskLookupKey({
    projectId: input.projectId,
    lampId: input.lampId,
    process: input.process,
  });
  const candidates = input.index.tasksByKey.get(key) ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const areaKey = normalizeImportLabel(input.areaName ?? "");
  if (areaKey) {
    const byArea = candidates.filter(
      (t) => t.areaLabel && normalizeImportLabel(t.areaLabel) === areaKey,
    );
    if (byArea.length === 1) return byArea[0]!;
  }

  return candidates[0] ?? null;
}

export function matchUserByOperatorName(
  index: LegacyEntityIndex,
  name: string,
): UserMatch | null {
  return index.usersByKey.get(normalizeImportLabel(name)) ?? null;
}
