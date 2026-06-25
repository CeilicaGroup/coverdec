-- AlterTable
ALTER TABLE "Planning" ADD COLUMN "planningGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Planning_planningGroupId_idx" ON "Planning"("planningGroupId");
