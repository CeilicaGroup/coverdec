-- AlterTable
ALTER TABLE "ProcessDefinition" ADD COLUMN "defaultNaveId" TEXT;

-- Backfill: primera nave activa por orden de código
UPDATE "ProcessDefinition"
SET "defaultNaveId" = (
  SELECT "id" FROM "Nave"
  WHERE "isActive" = true
  ORDER BY "codigo" ASC
  LIMIT 1
)
WHERE "defaultNaveId" IS NULL;

-- AddForeignKey
ALTER TABLE "ProcessDefinition" ADD CONSTRAINT "ProcessDefinition_defaultNaveId_fkey"
  FOREIGN KEY ("defaultNaveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;
