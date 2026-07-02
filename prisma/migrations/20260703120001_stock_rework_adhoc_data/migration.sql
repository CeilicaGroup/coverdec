-- AlterTable
ALTER TABLE "Lamp" ADD COLUMN "returnedToStockAt" TIMESTAMP(3),
ADD COLUMN "returnedToStockReason" TEXT,
ADD COLUMN "previousProjectId" TEXT;

-- AlterTable
ALTER TABLE "LampElement" ADD COLUMN "stockStatus" "LampElementStockStatus",
ADD COLUMN "stockBatchCode" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "createdByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Lamp" ADD CONSTRAINT "Lamp_previousProjectId_fkey" FOREIGN KEY ("previousProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ProcessDefinition" (
  "id", "code", "label", "factor", "setupHours", "waitHours",
  "bgColor", "fgColor", "borderColor", "canFragment"
)
SELECT
  gen_random_uuid()::text,
  'IMPREVISTA',
  'Imprevista',
  1,
  0,
  0,
  '#FCE7F3',
  '#9D174D',
  '#BE185D',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "ProcessDefinition" WHERE "code" = 'IMPREVISTA'
);

INSERT INTO "Project" (
  "id", "code", "name", "isBillable", "isActive", "kind", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  'STOCK-POOL',
  'Pool de stock',
  false,
  true,
  'STOCK'::"ProjectKind",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Project" WHERE "code" = 'STOCK-POOL'
);
