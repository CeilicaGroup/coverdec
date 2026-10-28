import { sumEffectiveAbsenceHoursForPersonOnDay } from "@/features/people/absence-model";
import { scheduledHoursForPersonDay } from "@/features/people/absence-schedule";
import { riskFromPlannedEnd } from "@/lib/format";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { weekDays } from "@/lib/week";
import { NotificationType, Role, type Prisma } from "@/generated/prisma";

export interface PlanningPublishAlert {
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  /** Solo estos usuarios (aviso personal del responsable); si falta, gestores. */
  recipientUserIds?: string[];
}

function computeCapacityForWeek(args: {
  days: Date[];
  people: {
    id: string;
    workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
  }[];
  absences: {
    personId: string;
    date: Date;
    endDate: Date;
    hours: number;
    blockStartMinutes: number | null;
    blockEndMinutes: number | null;
  }[];
  holidayDates: Set<string>;
}): number {
  let total = 0;
  for (const day of args.days) {
    const dayKey = day.toISOString().slice(0, 10);
    if (args.holidayDates.has(dayKey)) continue;
    for (const person of args.people) {
      const dayCap = scheduledHoursForPersonDay(day, person.workWindows);
      const absenceHours = sumEffectiveAbsenceHoursForPersonOnDay(
        args.absences,
        person.id,
        dayKey,
        person.workWindows,
      );
      total += Math.max(0, dayCap - absenceHours);
    }
  }
  return total;
}

export async function detectPlanningPublishNotifications(
  tx: Prisma.TransactionClient,
  planningId: string,
): Promise<PlanningPublishAlert[]> {
  const planning = await tx.planning.findUnique({
    where: { id: planningId },
    include: {
      assignments: {
        include: {
          task: {
            include: {
              project: {
                select: {
                  id: true,
                  code: true,
                  deliveryDate: true,
                  responsibleUserId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!planning) return [];

  const [people, absences, holidays] = await Promise.all([
    tx.person.findMany({
      where: {
        isActive: true,
        personNaves: { some: { naveId: planning.naveId } },
      },
      select: {
        id: true,
        workWindows: {
          select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
        },
      },
    }),
    tx.absence.findMany({
      where: {
        date: { lte: planning.weekEnd },
        endDate: { gte: planning.weekStart },
      },
      select: {
        personId: true,
        date: true,
        endDate: true,
        hours: true,
        blockStartMinutes: true,
        blockEndMinutes: true,
      },
    }),
    tx.holiday.findMany({
      where: {
        AND: [{ startDate: { lte: planning.weekEnd } }, { endDate: { gte: planning.weekStart } }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const holidayDates = expandHolidayRangesToIsoDays(holidays, planning.weekStart, planning.weekEnd);
  const days = weekDays(planning.weekStart);
  const capacityHours = computeCapacityForWeek({
    days,
    people,
    absences,
    holidayDates,
  });
  const assignedHours = planning.assignments.reduce((acc, a) => acc + a.hours, 0);
  const occupationPct = capacityHours > 0 ? Math.round((assignedHours / capacityHours) * 100) : 0;

  const notifications: PlanningPublishAlert[] = [];

  if (occupationPct < 100) {
    notifications.push({
      type: NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION,
      title: "Plan publicado con ocupación incompleta",
      body: `La semana quedó al ${occupationPct}% de ocupación (${assignedHours.toFixed(1)}h / ${capacityHours.toFixed(1)}h).`,
      payload: {
        eventKey: `plan-published-low-occupation:${planning.id}`,
        planningId: planning.id,
        naveId: planning.naveId,
        occupationPct,
        assignedHours,
        capacityHours,
      },
    });
  }

  const projectLastDate = new Map<string, Date>();
  const projectMeta = new Map<
    string,
    { code: string; deliveryDate: Date | null; responsibleUserId: string | null }
  >();
  for (const assignment of planning.assignments) {
    const project = assignment.task.project;
    projectMeta.set(project.id, {
      code: project.code,
      deliveryDate: project.deliveryDate,
      responsibleUserId: project.responsibleUserId,
    });
    const current = projectLastDate.get(project.id);
    if (!current || assignment.date > current) {
      projectLastDate.set(project.id, assignment.date);
    }
  }

  const riskyProjects = Array.from(projectLastDate.entries()).filter(([projectId, lastPlannedDate]) => {
    const meta = projectMeta.get(projectId);
    return riskFromPlannedEnd(meta?.deliveryDate ?? null, lastPlannedDate) === "RIESGO";
  });
  if (riskyProjects.length > 0) {
    notifications.push({
      type: NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE,
      title: "Plan publicado con proyectos fuera de plazo",
      body: `Se han detectado ${riskyProjects.length} proyectos en riesgo de salir fuera de fecha.`,
      payload: {
        eventKey: `plan-published-over-deadline:${planning.id}`,
        planningId: planning.id,
        naveId: planning.naveId,
        projectIds: riskyProjects.map(([projectId]) => projectId),
        projectCodes: riskyProjects.map(([projectId]) => projectMeta.get(projectId)?.code ?? projectId),
      },
    });

    // Cada responsable recibe un aviso solo con sus proyectos; admin y jefe ya tienen el global.
    const managers = await tx.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.JEFE_PRODUCCION] } },
      select: { id: true },
    });
    const managerIds = new Set(managers.map((u) => u.id));
    const projectIdsByResponsible = new Map<string, string[]>();
    for (const [projectId] of riskyProjects) {
      const responsible = projectMeta.get(projectId)?.responsibleUserId;
      if (!responsible || managerIds.has(responsible)) continue;
      const list = projectIdsByResponsible.get(responsible) ?? [];
      list.push(projectId);
      projectIdsByResponsible.set(responsible, list);
    }
    for (const [userId, projectIds] of projectIdsByResponsible) {
      const codes = projectIds.map((id) => projectMeta.get(id)?.code ?? id);
      notifications.push({
        type: NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE,
        title: "Plan publicado: tus proyectos salen fuera de plazo",
        body: `El planning publicado termina después de la entrega en: ${codes.join(", ")}.`,
        payload: {
          eventKey: `plan-published-over-deadline:${planning.id}:${userId}`,
          planningId: planning.id,
          naveId: planning.naveId,
          projectIds,
          projectCodes: codes,
        },
        recipientUserIds: [userId],
      });
    }
  }

  return notifications;
}
