-- CreateEnum
CREATE TYPE "ProductionOrderKind" AS ENUM ('PROYECTO', 'STOCK', 'ORT');
CREATE TYPE "ProductionOrderStatus" AS ENUM ('PEND', 'CURSO', 'INT', 'MULTI', 'CERR');
CREATE TYPE "ProductionOrderLineStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'FULFILLED');

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN "kind" "ProductionOrderKind" NOT NULL DEFAULT 'PROYECTO';
ALTER TABLE "ProductionOrder" ADD COLUMN "status" "ProductionOrderStatus" NOT NULL DEFAULT 'PEND';
ALTER TABLE "ProductionOrder" ADD COLUMN "naveId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "naveKey" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "elementTypeId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "step" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "parentOrderId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProductionOrder" ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProductionOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientLabel" TEXT,
    "units" INTEGER NOT NULL DEFAULT 1,
    "ral" TEXT,
    "colorHex" TEXT,
    "lineStatus" "ProductionOrderLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrderLine_pkey" PRIMARY KEY ("id")
);

-- Backfill: cada OP existente → una línea con su proyecto
INSERT INTO "ProductionOrderLine" ("id", "orderId", "projectId", "units", "lineStatus", "createdAt", "updatedAt")
SELECT
    'pol_' || "id",
    "id",
    "projectId",
    1,
    'ACTIVE',
    "createdAt",
    COALESCE("updatedAt", "createdAt")
FROM "ProductionOrder"
WHERE "projectId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ProductionOrder_status_scheduledAt_idx" ON "ProductionOrder"("status", "scheduledAt");
CREATE INDEX "ProductionOrder_elementTypeId_process_idx" ON "ProductionOrder"("elementTypeId", "process");
CREATE INDEX "ProductionOrderLine_orderId_lineStatus_idx" ON "ProductionOrderLine"("orderId", "lineStatus");
CREATE INDEX "ProductionOrderLine_projectId_idx" ON "ProductionOrderLine"("projectId");

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_naveId_fkey" FOREIGN KEY ("naveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "ElementType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
