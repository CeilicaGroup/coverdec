import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { isoWeek } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getPlanningForWeek({
  empresaId,
  weekStart,
}: {
  empresaId: string;
  weekStart: Date;
}) {
  const monday = getMondayOf(weekStart);
  const { year, week } = isoWeek(monday);
  const planning = await prisma.planning.findUnique({
    where: { empresaId_year_week: { empresaId, year, week } },
    include: {
      assignments: {
        include: {
          person: true,
          task: {
            include: {
              project: true,
              lamp: true,
            },
          },
        },
        orderBy: [{ date: "asc" }, { startSlot: "asc" }],
      },
    },
  });
  return planning;
}

export async function getEmpresaPeople() {
  return prisma.person.findMany({
    where: { isActive: true },
    include: { specialties: true },
    orderBy: { iniciales: "asc" },
  });
}

export async function getHolidaysForRange(start: Date, end: Date) {
  return prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
}

export async function getAbsencesForRange(start: Date, end: Date) {
  return prisma.absence.findMany({
    where: { date: { gte: start, lte: end } },
    include: { person: true },
    orderBy: { date: "asc" },
  });
}

export async function getActiveProjectsWithLoad(empresaId: string) {
  const projects = await prisma.project.findMany({
    where: { empresaId, isActive: true },
    include: {
      tasks: {
        select: {
          id: true,
          process: true,
          estimatedHours: true,
          pendingHours: true,
          doneHours: true,
        },
      },
    },
    orderBy: [
      { deliveryDate: { sort: "asc", nulls: "last" } },
      { name: "asc" },
    ],
  });
  return projects;
}

export function summarizePlanning(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
) {
  if (!planning) {
    return {
      totalHours: 0,
      byDay: new Map<string, number>(),
      byPerson: new Map<string, number>(),
    };
  }
  const byDay = new Map<string, number>();
  const byPerson = new Map<string, number>();
  let total = 0;
  for (const a of planning.assignments) {
    total += a.hours;
    const dayKey = a.date.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + a.hours);
    byPerson.set(a.personId, (byPerson.get(a.personId) ?? 0) + a.hours);
  }
  return { totalHours: total, byDay, byPerson };
}

export { DAY_MS };
