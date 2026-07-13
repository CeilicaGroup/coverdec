import { taskChainKey } from "@/features/planning/task-chain-key";

export interface WorkOrderSequenceTask {
  id: string;
  projectId: string;
  lampId: string;
  lampElementId?: string | null;
  order: number;
}

/** Orden estable para alinear workOrderSequence entre OT del mismo tipo físico. */
export function compareTasksForWorkOrderSequence(
  a: WorkOrderSequenceTask,
  b: WorkOrderSequenceTask,
): number {
  const projectCmp = a.projectId.localeCompare(b.projectId, "es");
  if (projectCmp !== 0) return projectCmp;

  const lampCmp = a.lampId.localeCompare(b.lampId, "es");
  if (lampCmp !== 0) return lampCmp;

  const chainCmp = taskChainKey(a).localeCompare(taskChainKey(b), "es");
  if (chainCmp !== 0) return chainCmp;

  return a.order - b.order || a.id.localeCompare(b.id, "es");
}

export function sortTasksForWorkOrderSequence<T extends WorkOrderSequenceTask>(
  tasks: T[],
): T[] {
  return [...tasks].sort(compareTasksForWorkOrderSequence);
}

export function sortTaskIdsForWorkOrderSequence<T extends WorkOrderSequenceTask>(
  tasks: T[],
): string[] {
  return sortTasksForWorkOrderSequence(tasks).map((task) => task.id);
}
