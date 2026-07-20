import {
  redirectToLoginWithStaleSession,
  requireSessionOrRedirect,
} from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma";
import {
  parsePlanningViewModeCookie,
  resolvePlanningViewMode,
  PLANNING_VIEW_MODE_COOKIE,
} from "@/features/planning/planning-visibility";
import { cookies } from "next/headers";
import { DashboardShell } from "./_components/dashboard-shell";
import { PushRegistration } from "./_components/push-registration";
import { isDevUserSwitcherEnabled } from "@/lib/dev-user-switcher";
import { listDevSwitcherUsers } from "@/features/dev/user-switcher-actions";

export const maxDuration = 900;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSessionOrRedirect();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      person: { include: { personNaves: { include: { nave: true } } } },
    },
  });
  if (!user) return redirectToLoginWithStaleSession();

  const allNaves = await prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });

  const canSwitchNave =
    user.role === Role.ADMIN || user.role === Role.JEFE_PRODUCCION;
  const personNaveList = [...(user.person?.personNaves.map((pn) => pn.nave) ?? [])].sort(
    (a, b) => a.codigo.localeCompare(b.codigo),
  );
  const shellNaves =
    user.role === Role.ADMIN || user.role === Role.JEFE_PRODUCCION
      ? allNaves
      : allNaves.filter((n) => personNaveList.some((pn) => pn.id === n.id));
  const activeNave = canSwitchNave
    ? (shellNaves.find((n) => n.id === user.activeNaveId) ??
        (user.role === Role.JEFE_PRODUCCION ? (shellNaves[0] ?? null) : null))
    : null;

  const cookieStore = await cookies();
  const planningViewMode =
    user.role === Role.ADMIN
      ? resolvePlanningViewMode(
          user.role,
          parsePlanningViewModeCookie(
            cookieStore.get(PLANNING_VIEW_MODE_COOKIE)?.value,
          ),
        )
      : "published_only";

  const devUserSwitcherEnabled = isDevUserSwitcherEnabled();
  const devSwitcherUsers = devUserSwitcherEnabled
    ? await listDevSwitcherUsers()
    : [];

  return (
    <DashboardShell
      user={{ id: user.id, name: user.name, role: user.role, email: user.email }}
      person={user.person ? { iniciales: user.person.iniciales, color: user.person.color } : null}
      naves={shellNaves}
      activeNave={activeNave}
      assignedNaves={canSwitchNave ? [] : personNaveList}
      planningViewMode={planningViewMode}
      devUserSwitcherEnabled={devUserSwitcherEnabled}
      devSwitcherUsers={devSwitcherUsers}
    >
      <PushRegistration />
      {children}
    </DashboardShell>
  );
}
