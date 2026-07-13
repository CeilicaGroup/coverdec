import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import { computeNextSlotForPersonDay } from "@/features/stock/move-lamp";
import { getMondayOf, isoWeek } from "@/lib/week";
import {
  IMPREVISTA_PROCESS_CODE,
  IMPREVISTA_UNKNOWN_ESTIMATED_HOURS,
} from "./constants";
import { getOrCreateImprevistasLamp } from "./imprevistas-lamp";

export interface CreateAdHocTaskInput {
  personId: string;
  naveId: string;
  notes?: string;
  createdByUserId: string;
  projectId?: string;
  process?: string;
}

function todayUtcDate(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function createAdHocTaskAndAssign(
  tx: Prisma.TransactionClient,
  input: CreateAdHocTaskInput,
): Promise<{ taskId: string; planningAssignmentId: string }> {
  const workDate = todayUtcDate();
  const monday = getMondayOf(workDate);
  const { year, week } = isoWeek(monday);
  const estimatedHours = IMPREVISTA_UNKNOWN_ESTIMATED_HOURS;

  const planning = await tx.planning.findUnique({
    where: {
      naveId_year_week: { naveId: input.naveId, year, week },
    },
    select: { id: true },
  });
  if (!planning) {
    throw new Error(
      "No hay planning de borrador para esta semana y nave. Genera el planning antes de asignar imprevistas.",
    );
  }

  const personAssignments = await tx.planningAssignment.findMany({
    where: {
      planningId: planning.id,
      personId: input.personId,
      date: workDate,
    },
    select: { endSlot: true },
  });

  const slot = computeNextSlotForPersonDay(
    personAssignments.map((assignment) => assignment.endSlot),
    estimatedHours,
  );

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
      estimatedHours,
      order: (maxOrder._max.order ?? 0) + 1,
      naveId: input.naveId,
      notes: input.notes?.trim() || null,
      systemKind: TaskSystemKind.AD_HOC,
      createdByUserId: input.createdByUserId,
    },
  });

  const assignment = await tx.planningAssignment.create({
    data: {
      planningId: planning.id,
      taskId: task.id,
      personId: input.personId,
      date: workDate,
      startSlot: slot.startSlot,
      endSlot: slot.endSlot,
      hours: estimatedHours,
      process,
      isOverride: true,
      isAfternoon: slot.isAfternoon,
      notes: input.notes?.trim() || null,
    },
  });

  return { taskId: task.id, planningAssignmentId: assignment.id };
}
