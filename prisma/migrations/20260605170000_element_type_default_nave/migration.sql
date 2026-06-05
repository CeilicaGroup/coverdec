-- Move default nave from processes to element types
ALTER TABLE "ElementType" ADD COLUMN "defaultNaveId" TEXT;

UPDATE "ElementType" et
SET "defaultNaveId" = (
  SELECT n."id" FROM "Nave" n WHERE n."isActive" = true ORDER BY n."codigo" ASC LIMIT 1
)
WHERE et."defaultNaveId" IS NULL;

ALTER TABLE "ElementType" ADD CONSTRAINT "ElementType_defaultNaveId_fkey"
  FOREIGN KEY ("defaultNaveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProcessDefinition" DROP CONSTRAINT IF EXISTS "ProcessDefinition_defaultNaveId_fkey";
ALTER TABLE "ProcessDefinition" DROP COLUMN IF EXISTS "defaultNaveId";
