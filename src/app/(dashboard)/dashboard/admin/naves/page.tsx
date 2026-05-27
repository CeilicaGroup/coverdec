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
          process: true,
          pendingHours: true,
          project: { select: { name: true, code: true } },
        },
      },
    },
  });

  return (
    <div>
      <PageHeader title="Gestión de naves" />
      <div className="px-6 pb-10">
        <NavesAdminClient naves={naves} />
      </div>
    </div>
  );
}
