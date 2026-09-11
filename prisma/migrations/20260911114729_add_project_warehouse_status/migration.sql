-- DropForeignKey
ALTER TABLE "Lamp" DROP CONSTRAINT "Lamp_elementTypeId_fkey";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isInWarehouse" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Lamp" ADD CONSTRAINT "Lamp_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "ElementType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
