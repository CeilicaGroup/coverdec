import { PlanningStatus, type Prisma } from "@/generated/prisma";

/**
 * Quién da por terminada una tarea cuando la OT tiene dos operarios (WorkOrderExecutor):
 *
 * - Tarea con requiredWorkers > 1 (preparación de chapas): trabajan los dos y firman los dos
 *   (los elegidos de la OT y los que el planning publicado asigna a la tarea).
 *   Cada firma deja de mostrar la tarea en la cola de quien firma; la tarea se cierra de verdad
 *   cuando han firmado todos los operarios de la OT. Las horas de cada uno se suman a la tarea.
 * - Resto de tareas: solo el responsable (position 0) la da por terminada. El apoyo registra
 *   sus horas pero nunca marca el proceso como terminado.
 */

export type CompletionDecision = "close" | "signoff" | "forbidden";

export function resolveCompletion(params: {
  requiredWorkers: number;
  /** Operarios elegidos a mano para la OT, por orden (el primero es el responsable). */
  executorIds: string[];
  /**
   * Personas que el planning publicado asigna a esta tarea. En las tareas de varios operarios
   * (requiredWorkers > 1) las asigna el planificador, sin pasar por los elegidos de la OT.
   */
  plannedIds?: string[];
  /** Quien completa; null si no es una persona del taller (p. ej. admin sin ficha). */
  personId: string | null;
  /** Quiénes han firmado ya esta tarea, sin contar a `personId`. */
  signedIds: string[];
}): CompletionDecision {
  const { requiredWorkers, executorIds, plannedIds = [], personId, signedIds } = params;
  if (requiredWorkers <= 1) {
    const position = personId ? executorIds.indexOf(personId) : -1;
    if (position < 0) return "close"; // no es operario de la OT: comportamiento de siempre
    return position === 0 ? "close" : "forbidden";
  }
  // Tarea de varios operarios: firman todos los que la tienen asignada.
  const required = [...new Set([...executorIds, ...plannedIds])];
  if (!personId || !required.includes(personId) || required.length < 2) return "close";
  const signed = new Set([...signedIds, personId]);
  return required.every((id) => signed.has(id)) ? "close" : "signoff";
}

export interface CompletableTask {
  id: string;
  requiredWorkers: number;
  workOrderId: string | null;
}

/**
 * Da por terminadas `tasks` en nombre de `personId`: las cierra, o solo deja la firma de esta
 * persona si faltan otros operarios por firmar. Lanza si es el apoyo de una OT.
 */
export async function completeTasksAsPerson(
  tx: Prisma.TransactionClient,
  tasks: CompletableTask[],
  personId: string | null,
): Promise<void> {
  if (tasks.length === 0) return;

  const workOrderIds = [...new Set(tasks.map((t) => t.workOrderId).filter((id): id is string => !!id))];
  const executorRows =
    workOrderIds.length === 0
      ? []
      : await tx.workOrderExecutor.findMany({
          where: { workOrderId: { in: workOrderIds } },
          orderBy: { position: "asc" },
          select: { workOrderId: true, personId: true },
        });
  const executorsByOt = new Map<string, string[]>();
  for (const row of executorRows) {
    executorsByOt.set(row.workOrderId, [...(executorsByOt.get(row.workOrderId) ?? []), row.personId]);
  }

  const syncTaskIds = tasks.filter((t) => t.requiredWorkers > 1).map((t) => t.id);
  const signedRows =
    syncTaskIds.length === 0
      ? []
      : await tx.taskSignoff.findMany({
          where: { taskId: { in: syncTaskIds } },
          select: { taskId: true, personId: true },
        });
  const signedByTask = new Map<string, string[]>();
  for (const row of signedRows) {
    signedByTask.set(row.taskId, [...(signedByTask.get(row.taskId) ?? []), row.personId]);
  }

  const plannedRows =
    syncTaskIds.length === 0
      ? []
      : await tx.planningAssignment.findMany({
          where: {
            taskId: { in: syncTaskIds },
            planning: { status: PlanningStatus.PUBLISHED },
            person: { isActive: true },
          },
          select: { taskId: true, personId: true },
          distinct: ["taskId", "personId"],
        });
  const plannedByTask = new Map<string, string[]>();
  for (const row of plannedRows) {
    plannedByTask.set(row.taskId, [...(plannedByTask.get(row.taskId) ?? []), row.personId]);
  }

  const toClose: string[] = [];
  const toSign: string[] = [];
  for (const task of tasks) {
    const decision = resolveCompletion({
      requiredWorkers: task.requiredWorkers,
      executorIds: task.workOrderId ? (executorsByOt.get(task.workOrderId) ?? []) : [],
      plannedIds: plannedByTask.get(task.id) ?? [],
      personId,
      signedIds: signedByTask.get(task.id) ?? [],
    });
    if (decision === "forbidden") {
      throw new Error(
        "Eres el apoyo de esta OT: registra tus horas, pero quien da la tarea por terminada es el responsable.",
      );
    }
    if (decision === "signoff") toSign.push(task.id);
    else toClose.push(task.id);
  }

  if (toSign.length > 0 && personId) {
    await tx.taskSignoff.createMany({
      data: toSign.map((taskId) => ({ taskId, personId })),
      skipDuplicates: true,
    });
  }
  if (toClose.length > 0) {
    await tx.task.updateMany({ where: { id: { in: toClose } }, data: { isCompleted: true } });
  }
}
