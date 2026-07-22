import {
  compareWorkOrdersByAttention,
  type WorkOrderAttentionMetrics,
} from "./attention-priority";
import {
  summarizeWorkOrderAssignee,
  summarizeWorkOrderElementProcess,
  type TaskAssigneeSummary,
} from "./display-context";
import type { WorkOrderTaskFilterable } from "./filter-tasks";

export const WORK_ORDER_SORT_COLUMNS = [
  "number",
  "status",
  "attention",
  "elementProcess",
  "assignee",
  "taskCount",
  "pendingHours",
  "createdAt",
  "closedAt",
] as const;

export type WorkOrderSortColumn = (typeof WORK_ORDER_SORT_COLUMNS)[number];
export type WorkOrderSortDirection = "asc" | "desc";

export interface WorkOrderSortState {
  column: WorkOrderSortColumn | null;
  direction: WorkOrderSortDirection;
}

export const DEFAULT_WORK_ORDER_SORT: WorkOrderSortState = {
  column: null,
  direction: "asc",
};

export interface WorkOrderSortableRow {
  number: string;
  status: "OPEN" | "CLOSED";
  createdAt: Date;
  closedAt: Date | null;
  pendingHours: number;
  taskCount: number;
  attention: WorkOrderAttentionMetrics;
  tasks: WorkOrderTaskFilterable[];
  taskIds: string[];
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
}

function compareNullableDates(
  a: Date | null,
  b: Date | null,
  direction: WorkOrderSortDirection,
): number {
  if (a == null && b == null) return 0;
  // Nulls always last regardless of direction.
  if (a == null) return 1;
  if (b == null) return -1;
  const delta = a.getTime() - b.getTime();
  return direction === "asc" ? delta : -delta;
}

function elementProcessSortKey(tasks: WorkOrderTaskFilterable[]): string {
  const summary = summarizeWorkOrderElementProcess(tasks);
  if (summary.kind === "unknown") return "";
  if (summary.kind === "multiple") return "Varios";
  return `${summary.elementName} · ${summary.processCode}`;
}

function assigneeSortKey(
  taskIds: string[],
  assigneeByTaskId: Map<string, TaskAssigneeSummary>,
): string {
  const summary = summarizeWorkOrderAssignee(taskIds, assigneeByTaskId);
  if (summary.kind === "none") return "";
  if (summary.kind === "multiple") return "Varios";
  return summary.assignee.label;
}

function compareByColumn(
  a: WorkOrderSortableRow,
  b: WorkOrderSortableRow,
  column: WorkOrderSortColumn,
  direction: WorkOrderSortDirection,
  assigneeByTaskId: Map<string, TaskAssigneeSummary>,
): number {
  let delta = 0;

  switch (column) {
    case "number":
      delta = compareStrings(a.number, b.number);
      break;
    case "status":
      delta = (a.status === "OPEN" ? 0 : 1) - (b.status === "OPEN" ? 0 : 1);
      break;
    case "attention": {
      const needsA = a.attention.needsAttention ? 0 : 1;
      const needsB = b.attention.needsAttention ? 0 : 1;
      delta = needsA - needsB;
      if (delta === 0) delta = a.attention.severity - b.attention.severity;
      break;
    }
    case "elementProcess":
      delta = compareStrings(
        elementProcessSortKey(a.tasks),
        elementProcessSortKey(b.tasks),
      );
      break;
    case "assignee":
      delta = compareStrings(
        assigneeSortKey(a.taskIds, assigneeByTaskId),
        assigneeSortKey(b.taskIds, assigneeByTaskId),
      );
      break;
    case "taskCount":
      delta = a.taskCount - b.taskCount;
      break;
    case "pendingHours":
      delta = a.pendingHours - b.pendingHours;
      break;
    case "createdAt":
      delta = a.createdAt.getTime() - b.createdAt.getTime();
      break;
    case "closedAt":
      return compareNullableDates(a.closedAt, b.closedAt, direction);
  }

  return direction === "asc" ? delta : -delta;
}

export function compareWorkOrdersForSort(
  a: WorkOrderSortableRow,
  b: WorkOrderSortableRow,
  sort: WorkOrderSortState,
  assigneeByTaskId: Map<string, TaskAssigneeSummary>,
): number {
  if (sort.column == null) {
    return compareWorkOrdersByAttention(a, b);
  }
  const delta = compareByColumn(a, b, sort.column, sort.direction, assigneeByTaskId);
  if (delta !== 0) return delta;
  return compareStrings(a.number, b.number);
}

export function sortWorkOrders<T extends WorkOrderSortableRow>(
  rows: T[],
  sort: WorkOrderSortState,
  assigneeByTaskId: Map<string, TaskAssigneeSummary>,
): T[] {
  return [...rows].sort((a, b) =>
    compareWorkOrdersForSort(a, b, sort, assigneeByTaskId),
  );
}

export function nextWorkOrderSortState(
  current: WorkOrderSortState,
  column: WorkOrderSortColumn,
): WorkOrderSortState {
  if (current.column !== column) {
    return { column, direction: "asc" };
  }
  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}
