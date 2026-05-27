import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  redirectToLoginWithStaleSession,
  requireSessionOrRedirect,
} from "@/lib/auth-server";
import { personNaveIds } from "@/features/people/person-naves";
import type { Role } from "@/generated/prisma";

export interface DashboardContext {
  userId: string;
  role: Role;
  personId: string | null;
  /** Admin: active nave filter; null = all. Operario/jefe: always null (aggregated view). */
  naveId: string | null;
  /** Naves the user can access (from linked Person.personNaves, or all active for admin). */
  naveIds: string[];
}

export async function requireDashboardContext(): Promise<DashboardContext> {
  const session = await requireSessionOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      person: { include: { personNaves: true } },
    },
  });
  if (!user) return redirectToLoginWithStaleSession();

  if (user.role === "ADMIN") {
    const activeNaves = await prisma.nave.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { codigo: "asc" },
    });
    const allIds = activeNaves.map((n) => n.id);
    const naveId = user.activeNaveId ?? null;
    return {
      userId: user.id,
      role: user.role,
      personId: user.personId,
      naveId,
      naveIds: naveId ? [naveId] : allIds,
    };
  }

  const naveIds = personNaveIds(user.person);
  return {
    userId: user.id,
    role: user.role,
    personId: user.personId,
    naveId: naveIds.length === 1 ? naveIds[0]! : null,
    naveIds,
  };
}

export function requireRole(
  ctx: DashboardContext,
  allowed: Role[],
): void {
  if (!allowed.includes(ctx.role)) {
    redirect("/dashboard");
  }
}
