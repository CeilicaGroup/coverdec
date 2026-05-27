import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import { NavesAdminClient } from "./naves-admin-client";

export default async function NavesAdminPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const naves = await prisma.nave.findMany({
    orderBy: { codigo: "asc" },
    include: {
      personNaves: {
        select: {
          person: {
            select: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
      },
      tasks: {
        select: {
          id: true,
          lamp: { select: { id: true, name: true } },
        },
      },
    },
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader title="Gestión de naves" />
      <NavesAdminClient naves={naves} />
    </div>
  );
}
