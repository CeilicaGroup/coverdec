import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { getMondayOf } from "@/lib/week";
import { PageHeader } from "../../_components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  markAllNotificationsReadFiltered,
  markAllNotificationsUnread,
} from "@/features/notifications/actions";
import { NotificationCard } from "./notification-card";

type FilterMode = "all" | "read" | "unread";

export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = (await searchParams) ?? {};
  const filter = (params.filter === "read" || params.filter === "unread" ? params.filter : "all") as FilterMode;
  const notifications = await prisma.notification.findMany({
    where: {
      userId: ctx.userId,
      ...(filter === "read" ? { readAt: { not: null } } : {}),
      ...(filter === "unread" ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      payload: true,
      readAt: true,
      createdAt: true,
      projectId: true,
      planningId: true,
      naveId: true,
    },
  });

  const planningIds = [
    ...new Set(
      notifications.map((n) => n.planningId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const plannings =
    planningIds.length > 0
      ? await prisma.planning.findMany({
          where: { id: { in: planningIds } },
          select: { id: true, weekStart: true },
        })
      : [];
  const planningWeekById = new Map(
    plannings.map((p) => [
      p.id,
      getMondayOf(p.weekStart).toISOString().slice(0, 10),
    ]),
  );

  const [unread, read, total] = await Promise.all([
    prisma.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    prisma.notification.count({ where: { userId: ctx.userId, readAt: { not: null } } }),
    prisma.notification.count({ where: { userId: ctx.userId } }),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Notificaciones"
        description={`${unread} sin leer · ${total} totales`}
        actions={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <form
              action={async () => {
                "use server";
                await markAllNotificationsReadFiltered({ filter });
              }}
            >
              <Button type="submit" variant="outline" size="sm" disabled={unread === 0}>
                Marcar visibles como leídas
              </Button>
            </form>
            <form
              action={async () => {
                "use server";
                await markAllNotificationsUnread({ filter });
              }}
            >
              <Button type="submit" variant="outline" size="sm" disabled={read === 0}>
                Marcar visibles como no leídas
              </Button>
            </form>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/dashboard/notificaciones?filter=all"
          className={filter === "all" ? "font-semibold underline" : "text-muted-foreground hover:text-foreground"}
        >
          Todos ({total})
        </Link>
        <Link
          href="/dashboard/notificaciones?filter=unread"
          className={filter === "unread" ? "font-semibold underline" : "text-muted-foreground hover:text-foreground"}
        >
          Sin leer ({unread})
        </Link>
        <Link
          href="/dashboard/notificaciones?filter=read"
          className={filter === "read" ? "font-semibold underline" : "text-muted-foreground hover:text-foreground"}
        >
          Leído ({read})
        </Link>
      </div>

      <div className="space-y-3">
        {notifications.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              No tienes notificaciones todavía.
            </CardContent>
          </Card>
        ) : (
          notifications.map((item) => (
            <NotificationCard
              key={item.id}
              id={item.id}
              type={item.type}
              title={item.title}
              body={item.body}
              payload={item.payload}
              readAt={item.readAt}
              createdAt={item.createdAt}
              linkContext={{
                projectId: item.projectId,
                planningId: item.planningId,
                planningWeekIso: item.planningId
                  ? planningWeekById.get(item.planningId)
                  : undefined,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
