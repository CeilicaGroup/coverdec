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

  const naves = await prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });

  const canSwitchNave = user.role === "ADMIN";
  const personNaveList = user.person?.personNaves.map((pn) => pn.nave) ?? [];
  const activeNave = canSwitchNave
    ? (naves.find((n) => n.id === user.activeNaveId) ?? null)
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

  return (
    <DashboardShell
      user={{ id: user.id, name: user.name, role: user.role, email: user.email }}
      person={user.person ? { iniciales: user.person.iniciales, color: user.person.color } : null}
      naves={naves}
      activeNave={activeNave}
      assignedNaves={canSwitchNave ? [] : personNaveList}
      planningViewMode={planningViewMode}
    >
      {children}
    </DashboardShell>
  );
}
