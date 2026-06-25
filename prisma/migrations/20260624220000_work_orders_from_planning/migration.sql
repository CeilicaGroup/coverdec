-- AlterTable
ALTER TABLE "PlanningPolicy" ADD COLUMN "wBatchSameWork" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "separateWorkOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN "scheduledWeek" TIMESTAMP(3);
ALTER TABLE "ProductionOrder" ADD COLUMN "planningGroupId" TEXT;

-- AlterTable
ALTER TABLE "ProductionOrderLine" ADD COLUMN "taskId" TEXT;

-- CreateIndex
CREATE INDEX "ProductionOrder_planningGroupId_process_naveId_scheduledWeek_idx" ON "ProductionOrder"("planningGroupId", "process", "naveId", "scheduledWeek");

-- CreateIndex
CREATE INDEX "ProductionOrderLine_taskId_idx" ON "ProductionOrderLine"("taskId");

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
