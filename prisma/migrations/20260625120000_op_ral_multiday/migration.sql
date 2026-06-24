-- AlterTable
ALTER TABLE "Lamp" ADD COLUMN "ral" TEXT;
ALTER TABLE "Lamp" ADD COLUMN "colorHex" TEXT;

-- AlterTable
ALTER TABLE "ProductionOrderLine" ADD COLUMN "completedUnits" INTEGER NOT NULL DEFAULT 0;
