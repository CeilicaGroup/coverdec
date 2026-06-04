"use client";

import { useState, useTransition } from "react";
import { NotificationType } from "@/generated/prisma";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { updateNotificationSubscription } from "@/features/notifications/actions";
import { notificationTypeMeta } from "@/features/notifications/types";
import { CONFIGURABLE_NOTIFICATION_TYPES } from "@/features/notifications/configurable-notification-types";

interface SubscriptionRow {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

interface Props {
  userId: string;
  subscriptions: SubscriptionRow[];
}

type Channel = "inApp" | "email" | "push";

export function NotificationSubscriptionsForm({ userId, subscriptions }: Props) {
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(() => {
    const state = new Map<string, { inApp: boolean; email: boolean; push: boolean }>();
    for (const type of CONFIGURABLE_NOTIFICATION_TYPES) {
      const row = subscriptions.find((s) => s.type === type);
      state.set(type, {
        inApp: row?.inApp ?? true,
        email: row?.email ?? true,
        push: row?.push ?? false,
      });
    }
    return state;
  });

  function onToggle(type: NotificationType, channel: Channel, value: boolean) {
    const current = local.get(type) ?? { inApp: true, email: true, push: false };
    const next = { ...current, [channel]: value };
    setLocal((prev) => new Map(prev).set(type, next));
    startTransition(async () => {
      try {
        await updateNotificationSubscription({
          userId,
          type,
          inApp: next.inApp,
          email: next.email,
          push: next.push,
        });
      } catch (err) {
        setLocal((prev) => new Map(prev).set(type, current));
        toast.error(err instanceof Error ? err.message : "No se pudo guardar");
      }
    });
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo de alerta</TableHead>
            <TableHead className="w-20 text-center">Interna</TableHead>
            <TableHead className="w-20 text-center">Email</TableHead>
            <TableHead className="w-20 text-center">Push</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CONFIGURABLE_NOTIFICATION_TYPES.map((type) => {
            const row = local.get(type) ?? { inApp: true, email: true, push: false };
            return (
              <TableRow key={type}>
                <TableCell className="text-sm">{notificationTypeMeta[type].label}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={row.inApp}
                      disabled={pending}
                      onCheckedChange={(v) => onToggle(type, "inApp", v === true)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={row.email}
                      disabled={pending}
                      onCheckedChange={(v) => onToggle(type, "email", v === true)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={row.push}
                      disabled={pending}
                      onCheckedChange={(v) => onToggle(type, "push", v === true)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
