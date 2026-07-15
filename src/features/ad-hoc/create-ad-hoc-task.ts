import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import {
  IMPREVISTA_PROCESS_CODE,
} from "./constants";
import { getOrCreateImprevistasLamp } from "./imprevistas-lamp";

export interface CreateAdHocTaskInput {
  personIds: string[];
  naveId: string;
  estimatedHours: number;
  notes?: string;
  createdByUserId: string;
  projectId?: string;
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

  let lampId: string;
  let projectId: string;

  if (input.projectId) {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, isActive: true },
      include: { lamps: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } },
    });
    if (!project) throw new Error("Proyecto no encontrado.");
    if (project.lamps[0]) {
      lampId = project.lamps[0].id;
      projectId = project.id;
    } else {
      const pool = await getOrCreateImprevistasLamp(tx);
      lampId = pool.id;
      projectId = pool.projectId;
    }
  } else {
    const pool = await getOrCreateImprevistasLamp(tx);
    lampId = pool.id;
    projectId = pool.projectId;
  }

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
      notes: input.notes?.trim() || null,
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
