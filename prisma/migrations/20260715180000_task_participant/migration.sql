-- CreateTable
CREATE TABLE "TaskParticipant" (
    "taskId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "TaskParticipant_pkey" PRIMARY KEY ("taskId","personId")
);

-- CreateIndex
CREATE INDEX "TaskParticipant_personId_idx" ON "TaskParticipant"("personId");

-- AddForeignKey
ALTER TABLE "TaskParticipant" ADD CONSTRAINT "TaskParticipant_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskParticipant" ADD CONSTRAINT "TaskParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill participants from existing ad-hoc planning assignments
INSERT INTO "TaskParticipant" ("taskId", "personId")
SELECT DISTINCT t."id", pa."personId"
FROM "Task" t
INNER JOIN "PlanningAssignment" pa ON pa."taskId" = t."id"
WHERE t."systemKind" = 'AD_HOC'
ON CONFLICT DO NOTHING;
