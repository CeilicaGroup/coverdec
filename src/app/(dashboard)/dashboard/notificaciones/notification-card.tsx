"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ArrowRight } from "lucide-react";
import type { NotificationType } from "@/generated/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatShortDate } from "@/lib/format";
import { notificationTypeMeta } from "@/features/notifications/types";
import {
  resolveNotificationAction,
  type NotificationLinkContext,
} from "@/features/notifications/notification-links";
import {
  markNotificationRead,
  markNotificationUnread,
} from "@/features/notifications/actions";

interface NotificationCardProps {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
  linkContext: NotificationLinkContext;
}

export function NotificationCard({
  id,
  type,
  title,
  body,
  payload,
  readAt,
  createdAt,
  linkContext,
}: NotificationCardProps) {
  const [pending, startTransition] = useTransition();
  const action = resolveNotificationAction(type, payload, linkContext);

  const toggleRead = () => {
    startTransition(async () => {
      if (readAt) {
        await markNotificationUnread({ notificationId: id });
      } else {
        await markNotificationRead({ notificationId: id });
      }
    });
  };

  return (
    <Card className={readAt ? "" : "border-primary/40"}>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant={readAt ? "outline" : "default"}>
              {notificationTypeMeta[type].label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatShortDate(createdAt)}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={toggleRead}
          >
            {readAt ? "Marcar no leída" : "Marcar leída"}
          </Button>
        </div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{body}</div>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex max-w-full flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80"
            onClick={() => {
              if (!readAt) {
                void markNotificationRead({ notificationId: id });
              }
            }}
          >
            <span className="truncate">{action.label}</span>
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
