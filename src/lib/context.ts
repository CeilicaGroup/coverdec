import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  redirectToLoginWithStaleSession,
  requireSessionOrRedirect,
} from "@/lib/auth-server";
import type { Role } from "@/generated/prisma";

export interface DashboardContext {
  userId: string;
  role: Role;
  empresaId: string;
  personId: string | null;
}

export async function requireDashboardContext(): Promise<DashboardContext> {
  const session = await requireSessionOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { memberships: true },
  });
  if (!user) return redirectToLoginWithStaleSession();
  const empresaId =
    user.activeEmpresaId ?? user.memberships[0]?.empresaId ?? null;
  if (!empresaId) {
    throw new Error("Usuario sin empresa asignada");
  }
  return {
    userId: user.id,
    role: user.role,
    empresaId,
    personId: user.personId,
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
