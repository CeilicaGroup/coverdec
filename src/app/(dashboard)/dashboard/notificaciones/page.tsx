import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { formatShortDate } from "@/lib/format";
import { PageHeader } from "../../_components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  markAllNotificationsReadFiltered,
  markAllNotificationsUnread,
  markNotificationRead,
  markNotificationUnread,
} from "@/features/notifications/actions";
import { notificationTypeMeta } from "@/features/notifications/types";

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
  });
  const [unread, read, total] = await Promise.all([
    prisma.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    prisma.notification.count({ where: { userId: ctx.userId, readAt: { not: null } } }),
    prisma.notification.count({ where: { userId: ctx.userId } }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Notificaciones"
        description={`${unread} sin leer · ${total} totales`}
        actions={
          <div className="flex items-center gap-2">
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

      <div className="flex items-center gap-2 text-sm">
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
            <Card key={item.id} className={item.readAt ? "" : "border-primary/40"}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.readAt ? "outline" : "default"}>
                      {notificationTypeMeta[item.type].label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatShortDate(item.createdAt)}
                    </span>
                  </div>
                  <form
                    action={async () => {
                      "use server";
                      if (item.readAt) {
                        await markNotificationUnread({ notificationId: item.id });
                      } else {
                        await markNotificationRead({ notificationId: item.id });
                      }
                    }}
                  >
                    <Button type="submit" variant="outline" size="sm">
                      {item.readAt ? "Marcar no leída" : "Marcar leída"}
                    </Button>
                  </form>
                </div>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="text-sm text-muted-foreground">{item.body}</div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
