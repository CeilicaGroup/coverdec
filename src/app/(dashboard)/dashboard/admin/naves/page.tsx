import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import { NavesAdminClient } from "./naves-admin-client";

export default async function NavesAdminPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const [naves, allUsers] = await Promise.all([
    prisma.nave.findMany({
      orderBy: { codigo: "asc" },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true },
        },
        tasks: {
          select: {
            id: true,
            process: true,
            pendingHours: true,
            project: { select: { name: true, code: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, naveId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader title="Gestión de naves" />
      <div className="px-6 pb-10">
        <NavesAdminClient naves={naves} allUsers={allUsers} />
      </div>
    </div>
  );
}
