import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import {
  IMPREVISTA_PROCESS_CODE,
} from "./constants";
import { resolveAdHocProjectLamp } from "./resolve-ad-hoc-project-lamp";

export interface CreateAdHocTaskInput {
  personIds: string[];
  naveId: string;
  estimatedHours: number;
  notes: string;
  internalNotes: string;
  createdByUserId: string;
  projectId: string;
  process?: string;
}

export async function createAdHocTaskRecord(
  tx: Prisma.TransactionClient,
  input: CreateAdHocTaskInput,
): Promise<{ taskId: string }> {
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) {
    throw new Error("Selecciona al menos un operario.");
  }

  const process = input.process?.trim() || IMPREVISTA_PROCESS_CODE;
  const notes = input.notes.trim();
  const internalNotes = input.internalNotes.trim();
  if (!notes) {
    throw new Error("Indica la observación para el empleado.");
  }
  if (!internalNotes) {
    throw new Error("Indica el motivo interno de la imprevista.");
  }

  const { projectId, lampId } = await resolveAdHocProjectLamp(tx, input.projectId);

  const maxOrder = await tx.task.aggregate({
    where: { lampId },
    _max: { order: true },
  });

  const task = await tx.task.create({
    data: {
      projectId,
      lampId,
      lampElementId: null,
      process,
      estimatedHours: input.estimatedHours,
      order: (maxOrder._max.order ?? 0) + 1,
      naveId: input.naveId,
      notes,
      internalNotes,
      systemKind: TaskSystemKind.AD_HOC,
      createdByUserId: input.createdByUserId,
      participants: {
        createMany: {
          data: personIds.map((personId) => ({ personId })),
        },
      },
    },
  });

  return { taskId: task.id };
}
