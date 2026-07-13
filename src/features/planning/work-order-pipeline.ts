import { taskChainKey } from "@/features/planning/task-chain-key";

export interface WorkOrderPipelineEdge {
  predecessorWorkOrderId: string;
  successorWorkOrderId: string;
  minCompletedHours: number;
}

export interface PipelineTask {
  id: string;
  lampId: string;
  lampElementId?: string | null;
  order: number;
  process: string;
  pendingHours: number;
  isCompleted: boolean;
  workOrderId?: string | null;
  workOrderSequence?: number | null;
}

function chainSortKey(task: PipelineTask): number {
  return task.order;
}

function findImmediatePredecessor(
  task: PipelineTask,
  tasksByChain: Map<string, PipelineTask[]>,
): PipelineTask | null {
  const chain = tasksByChain.get(taskChainKey(task));
  if (!chain) return null;

  let predecessor: PipelineTask | null = null;
  for (const candidate of chain) {
    if (candidate.id === task.id) break;
    if (candidate.order < task.order) {
      if (!predecessor || candidate.order > predecessor.order) {
        predecessor = candidate;
      }
    }
  }
  return predecessor;
}

function tasksByWorkOrderId(
  tasks: PipelineTask[],
): Map<string, PipelineTask[]> {
  const byWo = new Map<string, PipelineTask[]>();
  for (const task of tasks) {
    if (!task.workOrderId) continue;
    const list = byWo.get(task.workOrderId) ?? [];
    list.push(task);
    byWo.set(task.workOrderId, list);
  }
  for (const list of byWo.values()) {
    list.sort(
      (a, b) =>
        (a.workOrderSequence ?? 0) - (b.workOrderSequence ?? 0) ||
        a.id.localeCompare(b.id, "es"),
    );
  }
  return byWo;
}

function buildTasksByChain(tasks: PipelineTask[]): Map<string, PipelineTask[]> {
  const byChain = new Map<string, PipelineTask[]>();
  for (const task of tasks) {
    const key = taskChainKey(task);
    const list = byChain.get(key) ?? [];
    list.push(task);
    byChain.set(key, list);
  }
  for (const list of byChain.values()) {
    list.sort(
      (a, b) =>
        chainSortKey(a) - chainSortKey(b) ||
        a.process.localeCompare(b.process, "es"),
    );
  }
  return byChain;
}

function computeDirectPipelineEdge(
  predecessorWoId: string,
  successorWoId: string,
  predecessorIndex: number,
  woTasks: PipelineTask[],
  waitHoursByProcess: Map<string, number>,
): WorkOrderPipelineEdge | null {
  const predTask = woTasks[predecessorIndex];
  if (!predTask) return null;

  let minCompletedHours = 0;
  for (let i = 0; i <= predecessorIndex; i++) {
    minCompletedHours += woTasks[i]?.pendingHours ?? 0;
  }
  minCompletedHours += waitHoursByProcess.get(predTask.process) ?? 0;

  if (minCompletedHours <= 0) return null;

  return {
    predecessorWorkOrderId: predecessorWoId,
    successorWorkOrderId: successorWoId,
    minCompletedHours,
  };
}

/** OT con dependencia pipeline hacia o desde otra OT (no colapsar en el solver). */
export function workOrderIdsWithPipelineDependencies(
  edges: WorkOrderPipelineEdge[],
): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.predecessorWorkOrderId);
    ids.add(edge.successorWorkOrderId);
  }
  return ids;
}

/**
 * Calcula cuántas horas de la OT predecesora deben completarse antes de que
 * la OT sucesora pueda empezar, según las cadenas por elemento.
 */
export function computeWorkOrderPipelines(
  tasks: PipelineTask[],
  waitHoursByProcess: Map<string, number>,
): WorkOrderPipelineEdge[] {
  const byWo = tasksByWorkOrderId(tasks);
  const byChain = buildTasksByChain(tasks);
  const edges: WorkOrderPipelineEdge[] = [];

  for (const [successorWoId, woTasks] of byWo) {
    const firstPending = woTasks.find(
      (task) => !task.isCompleted && task.pendingHours > 0,
    );
    if (!firstPending) continue;

    const predecessor = findImmediatePredecessor(firstPending, byChain);
    if (!predecessor?.workOrderId) continue;
    if (predecessor.workOrderId === successorWoId) continue;
    if (predecessor.isCompleted || predecessor.pendingHours <= 0) continue;

    const predecessorWo = byWo.get(predecessor.workOrderId);
    if (!predecessorWo) continue;

    const predecessorIndex = predecessorWo.findIndex(
      (task) => task.id === predecessor.id,
    );
    if (predecessorIndex < 0) continue;

    const edge = computeDirectPipelineEdge(
      predecessor.workOrderId,
      successorWoId,
      predecessorIndex,
      predecessorWo,
      waitHoursByProcess,
    );
    if (edge) edges.push(edge);
  }

  return edges;
}
