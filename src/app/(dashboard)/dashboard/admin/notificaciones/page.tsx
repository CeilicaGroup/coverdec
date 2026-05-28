import { NotificationType, Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { PageHeader } from "../../../_components/page-header";
import { AdminNotificationsClient } from "./subscriptions-client";

export default async function AdminNotificacionesPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const [users, subscriptions] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.JEFE_PRODUCCION] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.notificationSubscription.findMany({
      select: { userId: true, type: true, inApp: true, email: true, push: true },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Configuración de notificaciones"
        description="Quién recibe cada alerta y por qué canal"
      />
      <AdminNotificationsClient
        users={users}
        subscriptions={subscriptions}
        allTypes={Object.values(NotificationType)}
      />
    </div>
  );
}
