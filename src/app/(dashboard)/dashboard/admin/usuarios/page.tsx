import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import { UsuariosAdminClient } from "./usuarios-admin-client";

export default async function UsuariosAdminPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const [users, naves] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      include: {
        nave: { select: { id: true, codigo: true, nombre: true } },
      },
    }),
    prisma.nave.findMany({ where: { isActive: true }, orderBy: { codigo: "asc" }, select: { id: true, codigo: true, nombre: true } }),
  ]);

  return (
    <div>
      <PageHeader title="Gestión de usuarios" />
      <div className="px-6 pb-10">
        <UsuariosAdminClient users={users} naves={naves} />
      </div>
    </div>
  );
}
