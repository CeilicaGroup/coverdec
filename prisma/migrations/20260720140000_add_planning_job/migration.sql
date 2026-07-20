-- CreateEnum
CREATE TYPE "PlanningJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "PlanningJob" (
    "id" TEXT NOT NULL,
    "status" "PlanningJobStatus" NOT NULL DEFAULT 'PENDING',
    "horizonMode" JSONB NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "planFromDate" TEXT,
    "progress" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanningJob_status_idx" ON "PlanningJob"("status");
