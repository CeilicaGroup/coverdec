import { riskFromPlannedEnd } from "@/lib/format";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { weekDays } from "@/lib/week";
import { NotificationType, type Prisma } from "@/generated/prisma";

function computeCapacityForWeek(args: {
  days: Date[];
  people: { id: string; capacityHours: number }[];
  absences: { personId: string; date: Date; hours: number }[];
  holidayDates: Set<string>;
}): number {
  let total = 0;
  for (const day of args.days) {
    const dayKey = day.toISOString().slice(0, 10);
    if (args.holidayDates.has(dayKey)) continue;
    for (const person of args.people) {
      const absence = args.absences.find(
        (a) => a.personId === person.id && a.date.toISOString().slice(0, 10) === dayKey,
      );
      total += Math.max(0, person.capacityHours - (absence?.hours ?? 0));
    }
  }
  return total;
}

function deriveDailyHoursFromWindows(
  windows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): number {
  const byDay = new Map<number, number>();
  for (const w of windows) {
    const span = Math.max(0, w.endMinutes - w.startMinutes) / 60;
    byDay.set(w.dayOfWeek, (byDay.get(w.dayOfWeek) ?? 0) + span);
  }
  const total = [1, 2, 3, 4, 5].reduce((acc, d) => acc + (byDay.get(d) ?? 0), 0);
  return total > 0 ? total / 5 : 8;
}

export async function detectPlanningPublishNotifications(
  tx: Prisma.TransactionClient,
  planningId: string,
): Promise<
  Array<{
    type: NotificationType;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    projectId?: string;
    responsibleUserId?: string | null;
  }>
> {
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
      where: { date: { gte: planning.weekStart, lte: planning.weekEnd } },
      select: { personId: true, date: true, hours: true },
    }),
    tx.holiday.findMany({
      where: {
        AND: [{ startDate: { lte: planning.weekEnd } }, { endDate: { gte: planning.weekStart } }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const peopleWithCapacity = people.map((p) => ({
    id: p.id,
    capacityHours: deriveDailyHoursFromWindows(p.workWindows),
  }));
  const holidayDates = expandHolidayRangesToIsoDays(holidays, planning.weekStart, planning.weekEnd);
  const days = weekDays(planning.weekStart);
  const capacityHours = computeCapacityForWeek({
    days,
    people: peopleWithCapacity,
    absences,
    holidayDates,
  });
  const assignedHours = planning.assignments.reduce((acc, a) => acc + a.hours, 0);
  const occupationPct = capacityHours > 0 ? Math.round((assignedHours / capacityHours) * 100) : 0;

  const notifications: Array<{
    type: NotificationType;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  }> = [];

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
  }

  return notifications;
}
