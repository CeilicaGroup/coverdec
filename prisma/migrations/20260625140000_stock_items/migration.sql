-- CreateEnum
CREATE TYPE "StockItemState" AS ENUM ('IMPRIMADO', 'CON_COLOR', 'ASSIGNED');

-- AlterEnum
ALTER TYPE "ProductionOrderStatus" ADD VALUE 'IMPRIMADO';

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "elementTypeId" TEXT,
    "lampLabel" TEXT,
    "state" "StockItemState" NOT NULL,
    "ral" TEXT,
    "colorHex" TEXT,
    "units" INTEGER NOT NULL,
    "accumulatedMinPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceOrderId" TEXT,
    "sourceLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockItem_state_elementTypeId_idx" ON "StockItem"("state", "elementTypeId");

-- CreateIndex
CREATE INDEX "StockItem_ral_idx" ON "StockItem"("ral");

-- CreateIndex
CREATE INDEX "StockItem_sourceOrderId_idx" ON "StockItem"("sourceOrderId");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "ElementType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
