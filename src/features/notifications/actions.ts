"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { NotificationType, Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { upsertNotificationSubscription } from "./service";

const updateSubscriptionSchema = z.object({
  userId: z.string().min(1),
  type: z.nativeEnum(NotificationType),
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});

export async function updateNotificationSubscription(input: z.infer<typeof updateSubscriptionSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const data = updateSubscriptionSchema.parse(input);
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { role: true },
  });
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.JEFE_PRODUCCION)) {
    throw new Error("Solo se pueden configurar administradores o jefes de producción.");
  }

  await upsertNotificationSubscription(data);
  revalidatePath("/dashboard/admin/notificaciones");
}

const markReadSchema = z.object({ notificationId: z.string().min(1) });

export async function markNotificationRead(input: z.infer<typeof markReadSchema>) {
  const ctx = await requireDashboardContext();
  const data = markReadSchema.parse(input);
  await prisma.notification.updateMany({
    where: {
      id: data.notificationId,
      userId: ctx.userId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  revalidatePath("/dashboard/notificaciones");
}

export async function markNotificationUnread(input: z.infer<typeof markReadSchema>) {
  const ctx = await requireDashboardContext();
  const data = markReadSchema.parse(input);
  await prisma.notification.updateMany({
    where: {
      id: data.notificationId,
      userId: ctx.userId,
    },
    data: { readAt: null },
  });
  revalidatePath("/dashboard/notificaciones");
}

export async function markAllNotificationsRead() {
  const ctx = await requireDashboardContext();
  await prisma.notification.updateMany({
    where: { userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/dashboard/notificaciones");
}

const massMarkSchema = z.object({
  filter: z.enum(["all", "read", "unread"]).default("all"),
});

export async function markAllNotificationsUnread(input?: z.infer<typeof massMarkSchema>) {
  const ctx = await requireDashboardContext();
  const { filter } = massMarkSchema.parse(input ?? { filter: "all" });
  await prisma.notification.updateMany({
    where: {
      userId: ctx.userId,
      ...(filter === "read" ? { readAt: { not: null } } : {}),
      ...(filter === "unread" ? { readAt: null } : {}),
    },
    data: { readAt: null },
  });
  revalidatePath("/dashboard/notificaciones");
}

export async function markAllNotificationsReadFiltered(input?: z.infer<typeof massMarkSchema>) {
  const ctx = await requireDashboardContext();
  const { filter } = massMarkSchema.parse(input ?? { filter: "all" });
  await prisma.notification.updateMany({
    where: {
      userId: ctx.userId,
      ...(filter === "read" ? { readAt: { not: null } } : {}),
      ...(filter === "unread" ? { readAt: null } : {}),
    },
    data: { readAt: new Date() },
  });
  revalidatePath("/dashboard/notificaciones");
}
