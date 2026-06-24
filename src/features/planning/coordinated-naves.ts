import type { DashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma";

/** Naves que deben planificarse, publicarse y deshacerse siempre en bloque. */
export async function getCoordinatedPlanningNaveIds(
  ctx: DashboardContext,
): Promise<string[]> {
  if (ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION) {
    const rows = await prisma.nave.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { codigo: "asc" },
    });
    return rows.map((n) => n.id);
  }
  return ctx.naveIds;
}
