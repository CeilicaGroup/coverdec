import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import {
  NotificationChannel,
  NotificationType,
  Role,
  type Prisma,
} from "@/generated/prisma";
import {
  notificationPayloadSchema,
  type NotificationPayloadByType,
} from "./types";

const log = childLogger({ module: "notifications.service" });

interface RecipientChannels {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

interface EmitContext<K extends NotificationType> {
  title: string;
  body: string;
  type: K;
  payload: NotificationPayloadByType[K];
  projectId?: string;
  planningId?: string;
  naveId?: string;
  responsibleUserId?: string | null;
  scopeKey?: string;
}

function defaultChannels(): RecipientChannels {
  return { inApp: true, email: true, push: false };
}

async function resolveRecipients(
  tx: Prisma.TransactionClient,
  args: { type: NotificationType; responsibleUserId?: string | null },
): Promise<Map<string, RecipientChannels>> {
  const managers = await tx.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.JEFE_PRODUCCION] } },
    select: { id: true },
  });
  const users = new Set(managers.map((u) => u.id));
  if (args.responsibleUserId) users.add(args.responsibleUserId);
  if (users.size === 0) return new Map();

  if (args.type === NotificationType.DELIVERY_FAILED) {
    return new Map(Array.from(users).map((userId) => [userId, { inApp: true, email: false, push: false }]));
  }

  const ids = Array.from(users);
  const subscriptions = await tx.notificationSubscription.findMany({
    where: { userId: { in: ids }, type: args.type },
    select: {
      userId: true,
      inApp: true,
      email: true,
      push: true,
    },
  });
  const byUser = new Map(
    subscriptions.map((sub) => [
      sub.userId,
      { inApp: sub.inApp, email: sub.email, push: sub.push },
    ]),
  );
  for (const userId of ids) {
    if (!byUser.has(userId)) byUser.set(userId, defaultChannels());
  }
  return byUser;
}

async function activateNotificationState(
  tx: Prisma.TransactionClient,
  args: { userId: string; type: NotificationType; scopeKey?: string },
): Promise<boolean> {
  const scopeKey = args.scopeKey?.trim();
  if (!scopeKey) return true;

  const existing = await tx.notificationState.findUnique({
    where: {
      userId_type_scopeKey: {
        userId: args.userId,
        type: args.type,
        scopeKey,
      },
    },
    select: { id: true, isActive: true },
  });

  if (existing?.isActive) {
    return false;
  }

  await tx.notificationState.upsert({
    where: {
      userId_type_scopeKey: {
        userId: args.userId,
        type: args.type,
        scopeKey,
      },
    },
    create: {
      userId: args.userId,
      type: args.type,
      scopeKey,
      isActive: true,
    },
    update: {
      isActive: true,
      resolvedAt: null,
      lastNotifiedAt: new Date(),
    },
  });

  return true;
}

export async function emitNotificationTx(
  tx: Prisma.TransactionClient,
  input: EmitContext<NotificationType>,
): Promise<void> {
  const payloadSchema = notificationPayloadSchema[input.type];
  const payload = payloadSchema.parse(input.payload);
  const scopeKey = input.scopeKey ?? payload.eventKey;
  const recipients = await resolveRecipients(tx, {
    type: input.type,
    responsibleUserId: input.responsibleUserId,
  });
  if (recipients.size === 0) return;

  for (const [userId, channels] of recipients) {
    const shouldEmit = await activateNotificationState(tx, {
      userId,
      type: input.type,
      scopeKey,
    });
    if (!shouldEmit) continue;

    let notificationId: string | null = null;
    if (channels.inApp) {
      const existing = await tx.notification.findFirst({
        where: {
          userId,
          type: input.type,
          payload: {
            path: ["eventKey"],
            equals: payload.eventKey,
          },
        },
        select: { id: true },
      });
      if (existing) {
        notificationId = existing.id;
      } else {
        const notification = await tx.notification.create({
          data: {
            userId,
            type: input.type,
            title: input.title,
            body: input.body,
            payload: payload as Prisma.InputJsonValue,
            projectId: input.projectId,
            planningId: input.planningId,
            naveId: input.naveId,
          },
          select: { id: true },
        });
        notificationId = notification.id;
      }
    }

    const deliveryRows: Prisma.NotificationDeliveryCreateManyInput[] = [];
    if (channels.email) {
      deliveryRows.push({
        userId,
        notificationId,
        type: input.type,
        channel: NotificationChannel.EMAIL,
        dedupeKey: `${payload.eventKey}:${userId}:email`,
        payload: {
          ...payload,
          title: input.title,
          body: input.body,
        } as Prisma.InputJsonValue,
      });
    }
    if (channels.push) {
      deliveryRows.push({
        userId,
        notificationId,
        type: input.type,
        channel: NotificationChannel.PUSH,
        dedupeKey: `${payload.eventKey}:${userId}:push`,
        payload: {
          ...payload,
          title: input.title,
          body: input.body,
        } as Prisma.InputJsonValue,
      });
    }

    if (deliveryRows.length > 0) {
      await tx.notificationDelivery.createMany({
        data: deliveryRows,
        skipDuplicates: true,
      });
    }
  }
}

export async function emitNotification(
  input: EmitContext<NotificationType>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await emitNotificationTx(tx, input);
  });
}

export async function upsertNotificationSubscription(input: {
  userId: string;
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  push: boolean;
}): Promise<void> {
  await prisma.notificationSubscription.upsert({
    where: {
      userId_type: { userId: input.userId, type: input.type },
    },
    create: input,
    update: {
      inApp: input.inApp,
      email: input.email,
      push: input.push,
    },
  });
}

export async function ensureDefaultSubscriptions(userId: string): Promise<void> {
  for (const type of Object.values(NotificationType)) {
    await prisma.notificationSubscription.upsert({
      where: { userId_type: { userId, type } },
      create: {
        userId,
        type,
        ...defaultChannels(),
      },
      update: {},
    });
  }
}

export function notificationLogError(context: string, err: unknown): void {
  log.error(
    {
      context,
      error: err instanceof Error ? err.message : String(err),
    },
    "notification operation failed",
  );
}

export async function resolveNotificationStates(args: {
  type: NotificationType;
  scopeKeys: string[];
}): Promise<void> {
  if (args.scopeKeys.length === 0) return;
  await prisma.notificationState.updateMany({
    where: {
      type: args.type,
      scopeKey: { in: args.scopeKeys },
      isActive: true,
    },
    data: {
      isActive: false,
      resolvedAt: new Date(),
    },
  });
}
