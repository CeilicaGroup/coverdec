import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";

/** Hay registros de horas desde el lunes de esta semana (personas de la nave). */
export async function hasRegistrosFromWeek(
  naveId: string,
  weekStart: Date,
): Promise<boolean> {
  const monday = getMondayOf(weekStart);
  const count = await prisma.timeEntry.count({
    where: {
      startedAt: { gte: monday },
      user: {
        personId: { not: null },
        person: { personNaves: { some: { naveId } } },
      },
    },
  });
  return count > 0;
}
