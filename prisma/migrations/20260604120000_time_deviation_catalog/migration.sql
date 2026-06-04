-- Time deviation policy + catalog deviation notification type

ALTER TYPE "NotificationType" ADD VALUE 'TASK_TIME_DEVIATION_FROM_CATALOG';

CREATE TABLE "TimeDeviationPolicy" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "deviationThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 15,
  "minCompletedSamples" INTEGER NOT NULL DEFAULT 3,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TimeDeviationPolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TimeDeviationPolicy" ("id", "deviationThresholdPct", "minCompletedSamples", "updatedAt")
VALUES ('singleton', 15, 3, CURRENT_TIMESTAMP);
