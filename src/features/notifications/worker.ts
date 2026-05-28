import webpush from "web-push";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { NotificationChannel, NotificationDeliveryStatus, NotificationType } from "@/generated/prisma";
import { riskFromPlannedEnd } from "@/lib/format";
import { emitNotification, notificationLogError, resolveNotificationStates } from "./service";

const log = childLogger({ module: "notifications.worker" });

const MAX_BATCH = 50;
const LOCK_STALE_MS = 5 * 60 * 1000;

function nowUtc(): Date {
  return new Date();
}

export async function claimPendingDeliveries(limit = MAX_BATCH) {
  const staleLock = new Date(Date.now() - LOCK_STALE_MS);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      channel: NotificationChannel;
      payload: unknown;
      attempts: number;
      maxAttempts: number;
      userId: string;
      type: NotificationType;
    }>
  >`
    WITH claim AS (
      SELECT "id"
      FROM "NotificationDelivery"
      WHERE
        ("status" = ${NotificationDeliveryStatus.PENDING}::"NotificationDeliveryStatus"
          OR "status" = ${NotificationDeliveryStatus.PROCESSING}::"NotificationDeliveryStatus")
        AND "nextAttemptAt" <= NOW()
        AND ("lockedAt" IS NULL OR "lockedAt" < ${staleLock})
      ORDER BY "nextAttemptAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "NotificationDelivery" d
    SET "status" = ${NotificationDeliveryStatus.PROCESSING}::"NotificationDeliveryStatus", "lockedAt" = NOW(), "updatedAt" = NOW()
    WHERE d."id" IN (SELECT "id" FROM claim)
    RETURNING d."id", d."channel", d."payload", d."attempts", d."maxAttempts", d."userId", d."type";
  `;
  return rows;
}

async function markDeliverySent(id: string) {
  await prisma.notificationDelivery.update({
    where: { id },
    data: {
      status: NotificationDeliveryStatus.SENT,
      sentAt: nowUtc(),
      lockedAt: null,
      lastError: null,
    },
  });
}

async function markDeliveryRetry(args: {
  id: string;
  attempts: number;
  maxAttempts: number;
  err: unknown;
  type: NotificationType;
  channel: NotificationChannel;
}) {
  const nextAttempts = args.attempts + 1;
  const failed = nextAttempts >= args.maxAttempts;
  const backoffMinutes = Math.min(60, 2 ** nextAttempts);
  const updated = await prisma.notificationDelivery.update({
    where: { id: args.id },
    data: {
      attempts: nextAttempts,
      status: failed ? NotificationDeliveryStatus.FAILED : NotificationDeliveryStatus.PENDING,
      lastError: args.err instanceof Error ? args.err.message : String(args.err),
      nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
      lockedAt: null,
    },
    select: { id: true, userId: true, attempts: true, lastError: true },
  });

  if (failed) {
    await emitNotification({
      type: NotificationType.DELIVERY_FAILED,
      title: "Fallo enviando una notificación",
      body: `No se pudo entregar un envío por ${args.channel} tras ${updated.attempts} intentos.`,
      payload: {
        eventKey: `delivery-failed:${updated.id}`,
        deliveryId: updated.id,
        originalType: args.type,
        channel: args.channel,
        attempts: updated.attempts,
        error: updated.lastError ?? "unknown",
      },
      scopeKey: `delivery-failed:${updated.id}`,
    });
  }
}

async function deliverEmail(delivery: { id: string; userId: string; payload: unknown }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Email channel not configured: missing RESEND_API_KEY or NOTIFICATION_FROM_EMAIL");
  }

  const user = await prisma.user.findUnique({
    where: { id: delivery.userId },
    select: { email: true },
  });
  if (!user?.email) {
    throw new Error(`Cannot deliver email: user ${delivery.userId} has no email`);
  }

  const payload = (delivery.payload ?? {}) as Record<string, unknown>;
  const subject = String(payload.title ?? "Notificación CoverDec");
  const body = String(payload.body ?? "Tienes una notificación nueva en CoverDec.");
  const html = `<p>${body}</p><p><a href="${process.env.BETTER_AUTH_URL ?? ""}/dashboard/notificaciones">Abrir notificaciones</a></p>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [user.email],
      subject,
      html,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend failed (${response.status}): ${errorBody}`);
  }
  log.info({ deliveryId: delivery.id, to: user.email }, "email delivered");
}

async function deliverPush(delivery: {
  id: string;
  userId: string;
  payload: unknown;
}) {
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    throw new Error("Missing VAPID keys");
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:alerts@coverdec.local",
    vapidPublic,
    vapidPrivate,
  );

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: delivery.userId, isActive: true },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return;

  const payload = (delivery.payload ?? {}) as Record<string, unknown>;
  const pushPayload = JSON.stringify({
    title: String(payload.title ?? "Notificación"),
    body: String(payload.body ?? "Tienes una nueva notificación"),
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: String(payload.eventKey ?? "coverdec-notification"),
    renotify: false,
    data: { url: "/dashboard/notificaciones" },
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        pushPayload,
      );
    } catch (err) {
      const statusCode =
        typeof err === "object" && err && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode ?? 0)
          : 0;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { isActive: false },
        });
      }
      throw err;
    }
  }
}

export async function processOutboxBatch(): Promise<number> {
  const claimed = await claimPendingDeliveries();
  if (claimed.length > 0) {
    log.info({ claimed: claimed.length }, "outbox deliveries claimed");
  }
  for (const delivery of claimed) {
    try {
      if (delivery.channel === NotificationChannel.EMAIL) {
        await deliverEmail(delivery);
      } else if (delivery.channel === NotificationChannel.PUSH) {
        await deliverPush(delivery);
      }
      await markDeliverySent(delivery.id);
    } catch (err) {
      await markDeliveryRetry({
        id: delivery.id,
        attempts: delivery.attempts,
        maxAttempts: delivery.maxAttempts,
        err,
        type: delivery.type,
        channel: delivery.channel,
      });
      notificationLogError("processOutboxBatch", err);
    }
  }
  return claimed.length;
}

export async function scanProjectSlipping(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { isActive: true, deliveryDate: { not: null } },
    select: {
      id: true,
      code: true,
      name: true,
      deliveryDate: true,
      responsibleUserId: true,
      tasks: {
        select: {
          assignments: {
            where: { planning: { status: "PUBLISHED" } },
            select: { date: true },
          },
        },
      },
    },
  });

  const riskyScopeKeys = new Set<string>();
  const allScopeKeys = new Set<string>();
  for (const project of projects) {
    const scopeKey = `project-slipping:${project.id}`;
    allScopeKeys.add(scopeKey);
    const dates = project.tasks.flatMap((t) => t.assignments.map((a) => a.date));
    if (dates.length === 0 || !project.deliveryDate) continue;
    const lastPlannedDate = dates.reduce((a, b) => (b > a ? b : a));
    if (riskFromPlannedEnd(project.deliveryDate, lastPlannedDate) !== "RIESGO") continue;
    riskyScopeKeys.add(scopeKey);
    await emitNotification({
      type: NotificationType.PROJECT_SLIPPING,
      title: "Proyecto en riesgo de retraso",
      body: `${project.code} (${project.name}) se está alargando por encima de la fecha prevista.`,
      payload: {
        eventKey: scopeKey,
        projectId: project.id,
        expectedEnd: lastPlannedDate.toISOString(),
        deliveryDate: project.deliveryDate.toISOString(),
      },
      projectId: project.id,
      responsibleUserId: project.responsibleUserId,
      scopeKey,
    });
  }

  const resolved = Array.from(allScopeKeys).filter((key) => !riskyScopeKeys.has(key));
  await resolveNotificationStates({
    type: NotificationType.PROJECT_SLIPPING,
    scopeKeys: resolved,
  });
}

export async function scanAssignedTasksNotLogged(): Promise<void> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const dateIso = start.toISOString().slice(0, 10);

  const assignments = await prisma.planningAssignment.findMany({
    where: {
      date: { gte: start, lt: end },
      planning: { status: "PUBLISHED" },
    },
    select: {
      planningId: true,
      personId: true,
      taskId: true,
      planning: { select: { naveId: true } },
    },
  });
  if (assignments.length === 0) return;

  const taskIds = Array.from(new Set(assignments.map((a) => a.taskId)));
  const loggedTaskRows = await prisma.timeEntry.findMany({
    where: {
      taskId: { in: taskIds },
      startedAt: { gte: start, lt: end },
      endedAt: { not: null },
      hours: { gt: 0 },
    },
    select: { taskId: true },
  });
  const loggedTasks = new Set(loggedTaskRows.map((r) => r.taskId).filter(Boolean));

  const byPlanning = new Map<string, { naveId: string; personIds: Set<string> }>();
  for (const assignment of assignments) {
    if (loggedTasks.has(assignment.taskId)) continue;
    const current = byPlanning.get(assignment.planningId) ?? {
      naveId: assignment.planning.naveId,
      personIds: new Set<string>(),
    };
    current.personIds.add(assignment.personId);
    byPlanning.set(assignment.planningId, current);
  }

  for (const [planningId, data] of byPlanning.entries()) {
    if (data.personIds.size === 0) continue;
    await emitNotification({
      type: NotificationType.ASSIGNED_TASKS_NOT_LOGGED,
      title: "Planning no seguido (sin partes de horas)",
      body: `Hay tareas planificadas para hoy sin registro de horas en el plan publicado.`,
      payload: {
        eventKey: `assigned-not-logged:${planningId}:${dateIso}`,
        planningId,
        naveId: data.naveId,
        dateIso,
        personIds: Array.from(data.personIds),
      },
      planningId,
      naveId: data.naveId,
      scopeKey: `assigned-not-logged:${planningId}:${dateIso}`,
    });
  }
}
