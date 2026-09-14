import { TaskSystemKind } from "@/generated/prisma";
import { taskHasPlanningAssignments } from "./task-planning-lock";

export const TASK_SUBSTITUTE_AD_HOC_ERROR =
  "Las tareas imprevistas ya admiten varios operarios; no necesitan sustituto.";
export const TASK_SUBSTITUTE_NOT_PLANNED_ERROR =
  "Solo se puede asignar sustituto a una tarea ya planificada.";
export const TASK_SUBSTITUTE_NAVE_MISMATCH_ERROR =
  "El sustituto debe pertenecer a la misma nave que la tarea.";

export function assertTaskSubstitutable(task: {
  systemKind: TaskSystemKind | null;
  _count?: { assignments: number };
}): void {
  if (task.systemKind === TaskSystemKind.AD_HOC) {
    throw new Error(TASK_SUBSTITUTE_AD_HOC_ERROR);
  }
  if (!taskHasPlanningAssignments(task)) {
    throw new Error(TASK_SUBSTITUTE_NOT_PLANNED_ERROR);
  }
}

export function assertPersonSharesNave(personNaveIds: string[], taskNaveId: string): void {
  if (!personNaveIds.includes(taskNaveId)) {
    throw new Error(TASK_SUBSTITUTE_NAVE_MISMATCH_ERROR);
  }
}
