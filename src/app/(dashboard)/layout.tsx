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
    include: {
      memberships: { include: { empresa: true } },
      person: true,
    },
  });
  if (!user) return redirectToLoginWithStaleSession();

  const empresas = user.memberships.map((m) => m.empresa);
  const activeEmpresa =
    empresas.find((e) => e.id === user.activeEmpresaId) ?? empresas[0];

  if (!activeEmpresa) {
    return (
      <div className="p-8">
        Tu usuario no tiene empresa asignada. Contacta con el administrador.
      </div>
    );
  }

  return (
    <DashboardShell
      user={{ id: user.id, name: user.name, role: user.role, email: user.email }}
      person={user.person ? { iniciales: user.person.iniciales, color: user.person.color } : null}
      empresas={empresas.map((e) => ({ id: e.id, nombre: e.nombre, marca: e.marca }))}
      activeEmpresa={{ id: activeEmpresa.id, nombre: activeEmpresa.nombre, marca: activeEmpresa.marca }}
    >
      {children}
    </DashboardShell>
  );
}
