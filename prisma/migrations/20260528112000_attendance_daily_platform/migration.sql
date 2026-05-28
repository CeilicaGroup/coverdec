-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('BUTTON', 'MANUAL', 'ADMIN_EDIT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_OUTSIDE_WORK_WINDOW';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_OPEN_TOO_LONG';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_INCOMPLETE_DAY';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_MISSING_WORKDAY';

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'BUTTON',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSession_userId_startedAt_idx" ON "AttendanceSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AttendanceSession_personId_startedAt_idx" ON "AttendanceSession"("personId", "startedAt");

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
