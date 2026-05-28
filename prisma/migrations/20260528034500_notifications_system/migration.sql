-- Notification system: in-app, email outbox, and web push subscriptions.

CREATE TYPE "NotificationType" AS ENUM (
  'PLAN_PUBLISHED_LOW_OCCUPATION',
  'PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE',
  'TASK_HOURS_EXCEEDED',
  'PROJECT_SLIPPING',
  'ASSIGNED_TASKS_NOT_LOGGED'
);

CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

ALTER TABLE "Project"
ADD COLUMN "responsibleUserId" TEXT;

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "payload" JSONB,
  "readAt" TIMESTAMP(3),
  "naveId" TEXT,
  "projectId" TEXT,
  "planningId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "inApp" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT true,
  "push" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "dedupeKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "expirationTime" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationSubscription_userId_type_key"
ON "NotificationSubscription"("userId", "type");
CREATE UNIQUE INDEX "NotificationDelivery_dedupeKey_key"
ON "NotificationDelivery"("dedupeKey");
CREATE UNIQUE INDEX "PushSubscription_endpoint_key"
ON "PushSubscription"("endpoint");

CREATE INDEX "Notification_userId_createdAt_idx"
ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_type_createdAt_idx"
ON "Notification"("type", "createdAt");
CREATE INDEX "NotificationSubscription_type_idx"
ON "NotificationSubscription"("type");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_channel_status_idx"
ON "NotificationDelivery"("channel", "status");
CREATE INDEX "PushSubscription_userId_isActive_idx"
ON "PushSubscription"("userId", "isActive");

ALTER TABLE "Project"
ADD CONSTRAINT "Project_responsibleUserId_fkey"
FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_naveId_fkey"
FOREIGN KEY ("naveId") REFERENCES "Nave"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_planningId_fkey"
FOREIGN KEY ("planningId") REFERENCES "Planning"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationSubscription"
ADD CONSTRAINT "NotificationSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery"
ADD CONSTRAINT "NotificationDelivery_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushSubscription"
ADD CONSTRAINT "PushSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
