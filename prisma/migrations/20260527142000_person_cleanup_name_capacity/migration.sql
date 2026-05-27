-- Backfill user name from person name when missing
UPDATE "User" u
SET "name" = p."nombre"
FROM "Person" p
WHERE u."personId" = p."id"
  AND (u."name" IS NULL OR btrim(u."name") = '')
  AND p."nombre" IS NOT NULL
  AND btrim(p."nombre") <> '';

-- Drop duplicated fields from Person
ALTER TABLE "Person" DROP COLUMN "nombre";
ALTER TABLE "Person" DROP COLUMN "capacityHours";
