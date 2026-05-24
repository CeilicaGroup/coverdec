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
  personId: string | null;
  naveId: string | null;
}

export async function requireDashboardContext(): Promise<DashboardContext> {
  const session = await requireSessionOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) return redirectToLoginWithStaleSession();
  const naveId =
    user.role === "ADMIN" ? (user.activeNaveId ?? null) : (user.naveId ?? null);
  return {
    userId: user.id,
    role: user.role,
    personId: user.personId,
    naveId,
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
