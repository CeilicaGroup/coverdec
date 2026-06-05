-- Backfill nameKey from display name before enforcing NOT NULL + unique constraint.
UPDATE "Lamp"
SET "nameKey" = regexp_replace(
  translate(
    lower(trim("name")),
    'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'
  ),
  '\s+',
  ' ',
  'g'
)
WHERE "nameKey" IS NULL;

UPDATE "Lamp"
SET "nameKey" = 'lamp-' || right("id", 6)
WHERE trim(coalesce("nameKey", '')) = '';

-- Resolve duplicate keys within the same project (keep oldest, suffix others).
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "projectId", "nameKey"
      ORDER BY "createdAt" ASC
    ) AS rn
  FROM "Lamp"
)
UPDATE "Lamp" AS l
SET "nameKey" = l."nameKey" || '-' || r.rn::text
FROM ranked AS r
WHERE l."id" = r."id"
  AND r.rn > 1;

-- AlterTable
ALTER TABLE "Lamp" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Lamp_projectId_nameKey_key" ON "Lamp"("projectId", "nameKey");
