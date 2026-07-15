"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AuditOutcome, Role } from "@/generated/prisma";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/auth-server";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getDefaultDashboardPath } from "@/lib/dashboard-path";
import { prisma } from "@/lib/db";
import { assertDevUserSwitcherEnabled } from "@/lib/dev-user-switcher";
import { childLogger } from "@/lib/logger";

const log = childLogger({ module: "dev.user-switcher" });

const ROLE_ORDER: Record<Role, number> = {
  [Role.ADMIN]: 0,
  [Role.JEFE_PRODUCCION]: 1,
  [Role.OPERARIO]: 2,
};

export interface DevSwitcherUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  iniciales: string | null;
}

async function requestHeaders() {
  return await headers();
}

function revalidateDashboardPaths() {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/login");
}

export async function listDevSwitcherUsers(): Promise<DevSwitcherUserRow[]> {
  assertDevUserSwitcherEnabled();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      person: { select: { iniciales: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  return users
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      iniciales: user.person?.iniciales ?? null,
    }))
    .sort((a, b) => {
      const roleDiff = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (roleDiff !== 0) return roleDiff;
      return a.name.localeCompare(b.name, "es");
    });
}

const switchDevUserSchema = z.object({
  userId: z.string().min(1),
});

export async function switchDevUser(
  input: z.infer<typeof switchDevUserSchema>,
): Promise<{ path: string }> {
  assertDevUserSwitcherEnabled();
  const { userId } = switchDevUserSchema.parse(input);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!target) throw new Error("Usuario no encontrado.");

  const hdrs = await requestHeaders();
  const currentSession = await getSession();
  const previousUserId = currentSession?.user.id ?? null;

  const result = await auth.api.devSwitchUser({
    body: { userId: target.id },
    headers: hdrs,
  });

  const requestMeta = {
    ipAddress:
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? hdrs.get("x-real-ip")
      ?? null,
    userAgent: hdrs.get("user-agent"),
  };

  await recordAuditEvent({
    action: "dev.userSwitch",
    category: "auth",
    outcome: AuditOutcome.SUCCESS,
    summary: `Cambio de usuario dev → ${target.name}`,
    actor: {
      userId: target.id,
      role: target.role,
      name: target.name,
      email: target.email,
      naveId: null,
    },
    request: requestMeta,
    entityType: "User",
    entityId: target.id,
    metadata: {
      previousUserId: result.previousUserId ?? previousUserId,
      targetUserId: target.id,
      targetRole: target.role,
    },
  });

  log.info(
    {
      previousUserId: result.previousUserId ?? previousUserId,
      targetUserId: target.id,
      targetRole: target.role,
    },
    "dev user switch",
  );

  revalidateDashboardPaths();

  return { path: getDefaultDashboardPath(target.role) };
}
