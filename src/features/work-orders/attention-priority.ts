export type WorkOrderAttentionStatus =
  | "normal"
  | "excess_hours"
  | "excess_tasks"
  | "excess_both";

export interface WorkOrderAttentionInput {
  status: "OPEN" | "CLOSED";
  pendingHours: number;
  taskCount: number;
  createdAt: Date;
}

export interface WorkOrderAttentionThresholds {
  maxPendingHours: number;
  maxTasks: number;
}

export interface WorkOrderAttentionMetrics {
  status: WorkOrderAttentionStatus;
  severity: number;
  needsAttention: boolean;
}

export interface WorkOrderAttentionRow {
  status: "OPEN" | "CLOSED";
  pendingHours: number;
  taskCount: number;
  createdAt: Date;
  attention: WorkOrderAttentionMetrics;
}

export function buildWorkOrderAttentionMetrics(
  input: Pick<WorkOrderAttentionInput, "status" | "pendingHours" | "taskCount">,
  thresholds: WorkOrderAttentionThresholds,
): WorkOrderAttentionMetrics {
  if (input.status !== "OPEN") {
    return { status: "normal", severity: 0, needsAttention: false };
  }

  const hoursExceeded = input.pendingHours > thresholds.maxPendingHours;
  const tasksExceeded = input.taskCount > thresholds.maxTasks;

  if (hoursExceeded && tasksExceeded) {
    return { status: "excess_both", severity: 3, needsAttention: true };
  }
  if (hoursExceeded) {
    return { status: "excess_hours", severity: 2, needsAttention: true };
  }
  if (tasksExceeded) {
    return { status: "excess_tasks", severity: 1, needsAttention: true };
  }
  return { status: "normal", severity: 0, needsAttention: false };
}

export function compareWorkOrdersByAttention(
  a: WorkOrderAttentionRow,
  b: WorkOrderAttentionRow,
): number {
  const openRankA = a.status === "OPEN" ? 0 : 1;
  const openRankB = b.status === "OPEN" ? 0 : 1;
  if (openRankA !== openRankB) return openRankA - openRankB;

  const attentionRankA = a.attention.needsAttention ? 0 : 1;
  const attentionRankB = b.attention.needsAttention ? 0 : 1;
  if (attentionRankA !== attentionRankB) return attentionRankA - attentionRankB;

  if (a.attention.severity !== b.attention.severity) {
    return b.attention.severity - a.attention.severity;
  }
  if (a.pendingHours !== b.pendingHours) {
    return b.pendingHours - a.pendingHours;
  }
  if (a.taskCount !== b.taskCount) {
    return b.taskCount - a.taskCount;
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}
