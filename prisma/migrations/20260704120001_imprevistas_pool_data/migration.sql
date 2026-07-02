-- Create IMPREVISTAS-POOL internal project.
INSERT INTO "Project" (
  "id", "code", "name", "isBillable", "isActive", "kind", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  'IMPREVISTAS-POOL',
  'Pool de imprevistas',
  false,
  true,
  'IMPREVISTAS'::"ProjectKind",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Project" WHERE "code" = 'IMPREVISTAS-POOL'
);

-- Move imprevistas container lamp from STOCK-POOL to IMPREVISTAS-POOL.
UPDATE "Lamp" AS l
SET "projectId" = imp.id
FROM "Project" AS stock,
     "Project" AS imp
WHERE stock."code" = 'STOCK-POOL'
  AND imp."code" = 'IMPREVISTAS-POOL'
  AND l."projectId" = stock.id
  AND l."nameKey" = 'imprevistas';

-- Move AD_HOC tasks that still reference STOCK-POOL via imprevistas lamp.
UPDATE "Task" AS t
SET "projectId" = imp.id
FROM "Lamp" AS l,
     "Project" AS stock,
     "Project" AS imp
WHERE stock."code" = 'STOCK-POOL'
  AND imp."code" = 'IMPREVISTAS-POOL'
  AND l."projectId" = imp.id
  AND l."nameKey" = 'imprevistas'
  AND t."lampId" = l.id
  AND t."projectId" = stock.id;

-- Align time entries with the new project for imprevista tasks.
UPDATE "TimeEntry" AS te
SET "projectId" = imp.id
FROM "Task" AS t,
     "Lamp" AS l,
     "Project" AS imp
WHERE imp."code" = 'IMPREVISTAS-POOL'
  AND l."projectId" = imp.id
  AND l."nameKey" = 'imprevistas'
  AND t."lampId" = l.id
  AND te."taskId" = t.id
  AND te."projectId" IS DISTINCT FROM imp.id;
