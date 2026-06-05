import { redirect } from "next/navigation";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  redirectToLoginWithStaleSession,
  requireSessionOrRedirect,
} from "@/lib/auth-server";
import { getDefaultDashboardPath } from "@/lib/dashboard-path";

export interface DashboardContext {
  userId: string;
  role: Role;
  personId: string | null;
  /** Nave activa para planificar. Admin puede dejarla en null (= vista global). Jefe: siempre una nave activa. */
  naveId: string | null;
  /** Naves accesibles: todas las activas (admin/jefe) o las de la persona (operario). */
  naveIds: string[];
}

export async function requireDashboardContext(): Promise<DashboardContext> {
  const session = await requireSessionOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      person: {
        include: {
          personNaves: {
            include: { nave: { select: { id: true, codigo: true } } },
          },
        },
      },
    },
  });
  if (!user) return redirectToLoginWithStaleSession();

  const activeNaveIds = await loadActiveNaveIds();

  if (user.role === Role.ADMIN) {
    const naveId =
      user.activeNaveId && activeNaveIds.includes(user.activeNaveId)
        ? user.activeNaveId
        : null;
    return {
      userId: user.id,
      role: user.role,
      personId: user.personId,
      naveId,
      naveIds: naveId ? [naveId] : activeNaveIds,
    };
  }

  if (user.role === Role.JEFE_PRODUCCION) {
    const naveId = resolvePlanningNaveId(user.activeNaveId, activeNaveIds);
    return {
      userId: user.id,
      role: user.role,
      personId: user.personId,
      naveId,
      naveIds: activeNaveIds,
    };
  }

  const personNaveIds = orderedPersonNaveIds(user.person);
  const naveId = resolvePlanningNaveId(user.activeNaveId, personNaveIds);
  return {
    userId: user.id,
    role: user.role,
    personId: user.personId,
    naveId,
    naveIds: personNaveIds,
  };
}

async function loadActiveNaveIds(): Promise<string[]> {
  const rows = await prisma.nave.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { codigo: "asc" },
  });
  return rows.map((n) => n.id);
}

function orderedPersonNaveIds(
  person: {
    personNaves: { naveId: string; nave: { codigo: string } }[];
  } | null | undefined,
): string[] {
  if (!person?.personNaves.length) return [];
  return [...person.personNaves]
    .sort((a, b) => a.nave.codigo.localeCompare(b.nave.codigo))
    .map((pn) => pn.naveId);
}

/** Nave para planificar: la elegida, o la primera disponible si hay alguna. */
function resolvePlanningNaveId(
  activeNaveId: string | null,
  naveIds: string[],
): string | null {
  if (naveIds.length === 0) return null;
  if (activeNaveId && naveIds.includes(activeNaveId)) return activeNaveId;
  return naveIds[0]!;
}

export function requireRole(
  ctx: DashboardContext,
  allowed: Role[],
): void {
  if (!allowed.includes(ctx.role)) {
    redirect(getDefaultDashboardPath(ctx.role));
  }
}
