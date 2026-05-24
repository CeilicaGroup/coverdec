-- FrameTypeProcess: orden dentro del bastidor
ALTER TABLE "FrameTypeProcess" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

-- Backfill sequence from ProcessDefinition.sequence per frame type
UPDATE "FrameTypeProcess" ftp
SET "sequence" = pd."sequence"
FROM "ProcessDefinition" pd
WHERE ftp."process" = pd."code";

-- Orphan tasks without lamp: delete if no planning/time refs, else attach to placeholder lamp
DELETE FROM "Task" t
WHERE t."lampId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "PlanningAssignment" pa WHERE pa."taskId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "TimeEntry" te WHERE te."taskId" = t."id");

-- Placeholder frame for legacy data (if needed)
INSERT INTO "FrameType" ("id", "code", "name", "description", "baseUnit", "isActive", "createdAt", "updatedAt")
SELECT
  'legacy-frame-placeholder',
  'LEGACY',
  'Legacy (migración)',
  'Bastidor temporal para lámparas sin tipo',
  'm2',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "FrameType" WHERE "code" = 'LEGACY');

-- Lamps without frameTypeId: assign legacy frame
UPDATE "Lamp"
SET "frameTypeId" = (SELECT "id" FROM "FrameType" WHERE "code" = 'LEGACY' LIMIT 1)
WHERE "frameTypeId" IS NULL;

-- Remaining orphan tasks: create one lamp per project
INSERT INTO "Lamp" ("id", "projectId", "frameTypeId", "name", "units", "createdAt", "updatedAt")
SELECT
  'legacy-lamp-' || p."id",
  p."id",
  (SELECT "id" FROM "FrameType" WHERE "code" = 'LEGACY' LIMIT 1),
  'Sin lámpara (migración)',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Project" p
WHERE EXISTS (SELECT 1 FROM "Task" t WHERE t."projectId" = p."id" AND t."lampId" IS NULL);

UPDATE "Task" t
SET "lampId" = 'legacy-lamp-' || t."projectId"
WHERE t."lampId" IS NULL;

-- Backfill task order per lamp by ProcessDefinition.sequence
WITH ranked AS (
  SELECT
    t."id",
    ROW_NUMBER() OVER (
      PARTITION BY t."lampId"
      ORDER BY pd."sequence" ASC, t."process" ASC
    ) - 1 AS ord
  FROM "Task" t
  JOIN "ProcessDefinition" pd ON pd."code" = t."process"
)
UPDATE "Task" t
SET "order" = ranked.ord
FROM ranked
WHERE t."id" = ranked."id";

CREATE INDEX "FrameTypeProcess_frameTypeId_sequence_idx" ON "FrameTypeProcess"("frameTypeId", "sequence");

-- Lamp.frameTypeId NOT NULL
ALTER TABLE "Lamp" ALTER COLUMN "frameTypeId" SET NOT NULL;

-- Task.lampId NOT NULL + FK on delete cascade
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_lampId_fkey";
ALTER TABLE "Task" ALTER COLUMN "lampId" SET NOT NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_lampId_fkey" FOREIGN KEY ("lampId") REFERENCES "Lamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
