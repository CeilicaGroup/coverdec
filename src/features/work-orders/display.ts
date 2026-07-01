import type { WorkOrderStatus } from "@/generated/prisma";

export interface WorkOrderDisplay {
  number: string;
  status: WorkOrderStatus;
}

export function getWorkOrderLabel(workOrder: WorkOrderDisplay | null | undefined): string | null {
  if (!workOrder) return null;
  return workOrder.number;
}

export function taskWorkOrderSummary(task: {
  workOrder?: WorkOrderDisplay | null;
}): WorkOrderDisplay | null {
  return task.workOrder ?? null;
}
