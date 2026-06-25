-- CreateEnum
CREATE TYPE "ElementRouteType" AS ENUM ('SIMPLE', 'SEQ_N3_N2', 'PARALLEL');

-- AlterTable
ALTER TABLE "Nave" ADD COLUMN "hourlyRate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ElementType" ADD COLUMN "routeType" "ElementRouteType" NOT NULL DEFAULT 'PARALLEL';
ALTER TABLE "ElementType" ADD COLUMN "routeNaves" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ElementType" ADD COLUMN "seqPhases" JSONB;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN "lampId" TEXT;

-- CreateIndex
CREATE INDEX "ProductionOrder_projectId_lampId_naveKey_idx" ON "ProductionOrder"("projectId", "lampId", "naveKey");

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_lampId_fkey" FOREIGN KEY ("lampId") REFERENCES "Lamp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
