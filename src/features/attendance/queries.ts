import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { madridDayBounds } from "./madrid-time";
import { attendanceRangeSchema } from "./validation";

// Lectura solo para servidor: fuera del módulo "use server" para no exponerla
// como endpoint ni auditarla en cada llamada.
export async function getAttendanceRange(input: {
  startDate: string;
  endDate: string;
  personId?: string;
}) {
  const ctx = await requireDashboardContext();
  const data = attendanceRangeSchema.parse(input);
  const start = madridDayBounds(data.startDate).start;
  const end = madridDayBounds(data.endDate).end;
  const include = {
    breaks: { orderBy: { startedAt: "asc" as const } },
  };
  if (ctx.role === Role.OPERARIO) {
    return prisma.attendanceSession.findMany({
      where: { userId: ctx.userId, startedAt: { gte: start, lt: end } },
      orderBy: { startedAt: "asc" },
      include,
    });
  }
  return prisma.attendanceSession.findMany({
    where: {
      startedAt: { gte: start, lt: end },
      ...(data.personId ? { personId: data.personId } : {}),
    },
    orderBy: { startedAt: "asc" },
    include,
  });
}
