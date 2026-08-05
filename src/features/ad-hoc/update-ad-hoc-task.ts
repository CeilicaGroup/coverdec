import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import { IMPREVISTA_PROCESS_CODE } from "./constants";
import { resolveAdHocProjectLamp } from "./resolve-ad-hoc-project-lamp";
import { taskHasPlanningAssignments } from "@/features/projects/task-planning-lock";

export const AD_HOC_EDIT_NOT_AD_HOC_ERROR =
  "Solo se pueden editar tareas imprevistas.";

export const AD_HOC_EDIT_COMPLETED_ERROR =
  "No se puede editar: la imprevista ya está completada.";

export const AD_HOC_EDIT_PLANNED_ERROR =
  "No se puede editar: la imprevista ya está en el planning.";

export const AD_HOC_EDIT_STRUCTURAL_WITH_TIME_ENTRIES_ERROR =
  "No se pueden cambiar operarios, horas, proyecto o nave: la imprevista tiene horas fichadas.";

export interface UpdateAdHocTaskInput {
  taskId: string;
  personIds: string[];
  naveId: string;
  estimatedHours: number;
  notes: string;
  internalNotes: string;
  projectId: string;
  process?: string;
}

export function assertCanEditAdHocTask(task: {
  systemKind: TaskSystemKind | null;
  isCompleted: boolean;
  _count: { assignments: number; timeEntries: number };
}): void {
  if (task.systemKind !== TaskSystemKind.AD_HOC) {
    throw new Error(AD_HOC_EDIT_NOT_AD_HOC_ERROR);
  }
  if (task.isCompleted) {
    throw new Error(AD_HOC_EDIT_COMPLETED_ERROR);
  }
  if (taskHasPlanningAssignments(task)) {
    throw new Error(AD_HOC_EDIT_PLANNED_ERROR);
  }
}

function normalizeNotes(notes: string, internalNotes: string) {
  const employee = notes.trim();
  const internal = internalNotes.trim();
  if (!employee) {
    throw new Error("Indica la observación para el empleado.");
  }
  if (!internal) {
    throw new Error("Indica el motivo interno de la imprevista.");
  }
  return { notes: employee, internalNotes: internal };
}

function structuralFieldsChanged(
  current: {
    projectId: string;
    naveId: string;
    estimatedHours: number;
    process: string;
    participantIds: string[];
  },
  input: UpdateAdHocTaskInput,
): boolean {
  const nextPersonIds = [...new Set(input.personIds)].sort();
  const currentPersonIds = [...current.participantIds].sort();
  if (nextPersonIds.length !== currentPersonIds.length) return true;
  if (nextPersonIds.some((id, index) => id !== currentPersonIds[index])) return true;
  if (current.projectId !== input.projectId) return true;
  if (current.naveId !== input.naveId) return true;
  if (current.estimatedHours !== input.estimatedHours) return true;
  if (current.process !== (input.process?.trim() || IMPREVISTA_PROCESS_CODE)) return true;
  return false;
}

export async function updateAdHocTaskRecord(
  tx: Prisma.TransactionClient,
  input: UpdateAdHocTaskInput,
): Promise<{ taskId: string }> {
  const task = await tx.task.findFirst({
    where: { id: input.taskId },
    include: {
      participants: { select: { personId: true } },
      _count: { select: { assignments: true, timeEntries: true } },
    },
  });
  if (!task) throw new Error("Tarea no encontrada.");

  assertCanEditAdHocTask(task);

  const { notes, internalNotes } = normalizeNotes(input.notes, input.internalNotes);
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) {
    throw new Error("Selecciona al menos un operario.");
  }

  const process = input.process?.trim() || IMPREVISTA_PROCESS_CODE;
  const hasTimeEntries = task._count.timeEntries > 0;
  const changedStructurally = structuralFieldsChanged(
    {
      projectId: task.projectId,
      naveId: task.naveId,
      estimatedHours: task.estimatedHours,
      process: task.process,
      participantIds: task.participants.map((row) => row.personId),
    },
    input,
  );

  if (hasTimeEntries && changedStructurally) {
    throw new Error(AD_HOC_EDIT_STRUCTURAL_WITH_TIME_ENTRIES_ERROR);
  }

  if (hasTimeEntries) {
    await tx.task.update({
      where: { id: task.id },
      data: { notes, internalNotes },
    });
    return { taskId: task.id };
  }

  const { projectId, lampId } = await resolveAdHocProjectLamp(tx, input.projectId);

  await tx.taskParticipant.deleteMany({ where: { taskId: task.id } });
  await tx.task.update({
    where: { id: task.id },
    data: {
      projectId,
      lampId,
      process,
      estimatedHours: input.estimatedHours,
      naveId: input.naveId,
      notes,
      internalNotes,
      participants: {
        createMany: {
          data: personIds.map((personId) => ({ personId })),
        },
      },
    },
  });

  return { taskId: task.id };
}
