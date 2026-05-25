import {
  redirectToLoginWithStaleSession,
  requireSessionOrRedirect,
} from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { DashboardShell } from "./_components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSessionOrRedirect();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { person: true },
  });
  if (!user) return redirectToLoginWithStaleSession();

  const naves = await prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });

  const canSwitchNave = user.role === "ADMIN" || user.role === "JEFE_PRODUCCION";
  const activeNaveId = canSwitchNave ? user.activeNaveId : user.naveId;
  const activeNave = naves.find((n) => n.id === activeNaveId) ?? null;

  return (
    <DashboardShell
      user={{ id: user.id, name: user.name, role: user.role, email: user.email }}
      person={user.person ? { iniciales: user.person.iniciales, color: user.person.color } : null}
      naves={naves}
      activeNave={activeNave}
    >
      {children}
    </DashboardShell>
  );
}
