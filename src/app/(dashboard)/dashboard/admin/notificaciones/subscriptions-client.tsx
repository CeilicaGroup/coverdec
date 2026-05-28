"use client";

import { useState, useTransition } from "react";
import { NotificationType } from "@/generated/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { updateNotificationSubscription } from "@/features/notifications/actions";
import { notificationTypeMeta } from "@/features/notifications/types";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface SubscriptionRow {
  userId: string;
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

interface Props {
  users: UserRow[];
  subscriptions: SubscriptionRow[];
  allTypes: NotificationType[];
}

type Channel = "inApp" | "email" | "push";

export function AdminNotificationsClient({ users, subscriptions, allTypes }: Props) {
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(() => {
    const state = new Map<string, { inApp: boolean; email: boolean; push: boolean }>();
    for (const user of users) {
      for (const type of allTypes) {
        const row = subscriptions.find((s) => s.userId === user.id && s.type === type);
        state.set(`${user.id}:${type}`, {
          inApp: row?.inApp ?? true,
          email: row?.email ?? true,
          push: row?.push ?? false,
        });
      }
    }
    return state;
  });

  function onToggle(userId: string, type: NotificationType, channel: Channel, value: boolean) {
    const key = `${userId}:${type}`;
    const current = local.get(key) ?? { inApp: true, email: true, push: false };
    const next = { ...current, [channel]: value };
    setLocal((prev) => new Map(prev).set(key, next));
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
        setLocal((prev) => new Map(prev).set(key, current));
        toast.error(err instanceof Error ? err.message : "No se pudo guardar");
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="w-24 text-center">Interna</TableHead>
              <TableHead className="w-24 text-center">Email</TableHead>
              <TableHead className="w-24 text-center">Push</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.flatMap((user) =>
              allTypes.map((type) => {
                const key = `${user.id}:${type}`;
                const row = local.get(key) ?? { inApp: true, email: true, push: false };
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email} · {user.role}</div>
                    </TableCell>
                    <TableCell className="text-sm">{notificationTypeMeta[type].label}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={row.inApp}
                          disabled={pending}
                          onCheckedChange={(v) => onToggle(user.id, type, "inApp", v === true)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={row.email}
                          disabled={pending}
                          onCheckedChange={(v) => onToggle(user.id, type, "email", v === true)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={row.push}
                          disabled={pending}
                          onCheckedChange={(v) => onToggle(user.id, type, "push", v === true)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
