import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import { CONFIGURABLE_NOTIFICATION_TYPES } from "@/features/notifications/configurable-notification-types";
import { UsuariosAdminClient } from "./usuarios-admin-client";

export default async function UsuariosAdminPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const [users, naves, subscriptions] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        person: {
          select: {
            id: true,
            personNaves: {
              select: {
                nave: { select: { id: true, codigo: true, nombre: true } },
              },
            },
          },
        },
      },
    }),
    prisma.nave.findMany({ where: { isActive: true }, orderBy: { codigo: "asc" }, select: { id: true, codigo: true, nombre: true } }),
    prisma.notificationSubscription.findMany({
      where: {
        user: { role: { in: [Role.ADMIN, Role.JEFE_PRODUCCION] } },
        type: { in: [...CONFIGURABLE_NOTIFICATION_TYPES] },
      },
      select: { userId: true, type: true, inApp: true, email: true, push: true },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Gestión de usuarios"
        description="Cuentas, naves y preferencias de alertas para administradores y jefes"
      />
      <UsuariosAdminClient users={users} naves={naves} subscriptions={subscriptions} />
    </div>
  );
}
