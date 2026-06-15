-- CreateTable
CREATE TABLE "AttendanceBreak" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'BUTTON',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceBreak_sessionId_startedAt_idx" ON "AttendanceBreak"("sessionId", "startedAt");

-- AddForeignKey
ALTER TABLE "AttendanceBreak" ADD CONSTRAINT "AttendanceBreak_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
