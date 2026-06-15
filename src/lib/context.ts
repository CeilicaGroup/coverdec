import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { setAuditRequestContext } from "@/lib/audit/request-context";
import {
  redirectToLoginWithStaleSession,
  requireSessionOrRedirect,
} from "@/lib/auth-server";
import { getDefaultDashboardPath } from "@/lib/dashboard-path";

export interface DashboardContext {
  userId: string;
  role: Role;
  name: string;
  email: string;
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
  const hdrs = await headers();
  const ipAddress =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? hdrs.get("x-real-ip")
    ?? null;
  const userAgent = hdrs.get("user-agent");

  let ctx: DashboardContext;

  if (user.role === Role.ADMIN) {
    const naveId =
      user.activeNaveId && activeNaveIds.includes(user.activeNaveId)
        ? user.activeNaveId
        : null;
    ctx = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      personId: user.personId,
      naveId,
      naveIds: naveId ? [naveId] : activeNaveIds,
    };
  } else if (user.role === Role.JEFE_PRODUCCION) {
    const naveId = resolvePlanningNaveId(user.activeNaveId, activeNaveIds);
    ctx = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      personId: user.personId,
      naveId,
      naveIds: activeNaveIds,
    };
  } else {
    const personNaveIds = orderedPersonNaveIds(user.person);
    const naveId = resolvePlanningNaveId(user.activeNaveId, personNaveIds);
    ctx = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      personId: user.personId,
      naveId,
      naveIds: personNaveIds,
    };
  }

  setAuditRequestContext({
    actor: {
      userId: ctx.userId,
      role: ctx.role,
      name: ctx.name,
      email: ctx.email,
      naveId: ctx.naveId,
    },
    request: { ipAddress, userAgent },
  });

  return ctx;
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
