-- PR-04: FrameType → ElementType, LampFrame → LampElement, typology + nave

CREATE TYPE "ElementTypology" AS ENUM ('TELA', 'BASTIDOR', 'ILUMINACION');

ALTER TABLE "FrameType" RENAME TO "ElementType";

ALTER TABLE "ElementType" ADD COLUMN "typology" "ElementTypology" NOT NULL DEFAULT 'BASTIDOR';
ALTER TABLE "ElementType" ADD COLUMN "defaultNaveId" TEXT;

UPDATE "ElementType" SET "typology" = 'TELA' WHERE "code" = 'TELA';

UPDATE "ElementType" et
SET "defaultNaveId" = (SELECT n."id" FROM "Nave" n WHERE n."isActive" = true ORDER BY n."codigo" ASC LIMIT 1)
WHERE et."defaultNaveId" IS NULL;

ALTER TABLE "ElementType" ADD CONSTRAINT "ElementType_defaultNaveId_fkey"
  FOREIGN KEY ("defaultNaveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ElementType_typology_isActive_idx" ON "ElementType"("typology", "isActive");

ALTER TABLE "FrameTypeProcess" RENAME TO "ElementTypeProcess";
ALTER TABLE "ElementTypeProcess" RENAME COLUMN "frameTypeId" TO "elementTypeId";

ALTER INDEX "FrameTypeProcess_frameTypeId_sequence_idx" RENAME TO "ElementTypeProcess_elementTypeId_sequence_idx";
ALTER INDEX "FrameTypeProcess_frameTypeId_process_key" RENAME TO "ElementTypeProcess_elementTypeId_process_key";

ALTER TABLE "ElementTypeProcess" RENAME CONSTRAINT "FrameTypeProcess_pkey" TO "ElementTypeProcess_pkey";
ALTER TABLE "ElementTypeProcess" RENAME CONSTRAINT "FrameTypeProcess_frameTypeId_fkey" TO "ElementTypeProcess_elementTypeId_fkey";
ALTER TABLE "ElementTypeProcess" RENAME CONSTRAINT "FrameTypeProcess_process_fkey" TO "ElementTypeProcess_process_fkey";

ALTER TABLE "Lamp" RENAME COLUMN "frameTypeId" TO "elementTypeId";
ALTER TABLE "Lamp" RENAME CONSTRAINT "Lamp_frameTypeId_fkey" TO "Lamp_elementTypeId_fkey";

ALTER TABLE "LampFrame" RENAME TO "LampElement";
ALTER TABLE "LampElement" RENAME COLUMN "frameTypeId" TO "elementTypeId";

ALTER TABLE "LampElement" ADD COLUMN "naveId" TEXT;

UPDATE "LampElement" le
SET "naveId" = COALESCE(
  (SELECT t."naveId" FROM "Task" t WHERE t."lampFrameId" = le."id" LIMIT 1),
  (SELECT n."id" FROM "Nave" n WHERE n."isActive" = true ORDER BY n."codigo" ASC LIMIT 1)
);

ALTER TABLE "LampElement" ALTER COLUMN "naveId" SET NOT NULL;

ALTER TABLE "LampElement" ADD CONSTRAINT "LampElement_naveId_fkey"
  FOREIGN KEY ("naveId") REFERENCES "Nave"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER INDEX "LampFrame_lampId_idx" RENAME TO "LampElement_lampId_idx";
ALTER INDEX "LampFrame_frameTypeId_idx" RENAME TO "LampElement_elementTypeId_idx";
ALTER INDEX "LampFrame_lampId_frameTypeId_label_key" RENAME TO "LampElement_lampId_elementTypeId_label_key";

ALTER TABLE "LampElement" RENAME CONSTRAINT "LampFrame_pkey" TO "LampElement_pkey";
ALTER TABLE "LampElement" RENAME CONSTRAINT "LampFrame_lampId_fkey" TO "LampElement_lampId_fkey";
ALTER TABLE "LampElement" RENAME CONSTRAINT "LampFrame_frameTypeId_fkey" TO "LampElement_elementTypeId_fkey";

ALTER TABLE "Task" RENAME COLUMN "lampFrameId" TO "lampElementId";
ALTER INDEX "Task_lampFrameId_idx" RENAME TO "Task_lampElementId_idx";
ALTER TABLE "Task" RENAME CONSTRAINT "Task_lampFrameId_fkey" TO "Task_lampElementId_fkey";

ALTER TABLE "ElementType" RENAME CONSTRAINT "FrameType_pkey" TO "ElementType_pkey";
ALTER INDEX "FrameType_code_key" RENAME TO "ElementType_code_key";
