ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED';

CREATE TABLE "NotificationState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "firstNotifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastNotifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationState_userId_type_scopeKey_key"
ON "NotificationState"("userId", "type", "scopeKey");

CREATE INDEX "NotificationState_type_scopeKey_idx"
ON "NotificationState"("type", "scopeKey");

ALTER TABLE "NotificationState"
ADD CONSTRAINT "NotificationState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
