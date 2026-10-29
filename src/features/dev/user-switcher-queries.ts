import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { assertDevUserSwitcherEnabled } from "@/lib/dev-user-switcher";

// Lectura solo para Server Components (layout y login): fuera del módulo "use server"
// para no exponerla como endpoint ni auditarla en cada render.

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
