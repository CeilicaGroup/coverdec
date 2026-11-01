-- Operarios elegidos a mano para una OT, guardados aunque la OT aún no esté planificada.

-- CreateTable
CREATE TABLE "WorkOrderExecutor" (
    "workOrderId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "WorkOrderExecutor_pkey" PRIMARY KEY ("workOrderId","personId")
);

-- CreateIndex
CREATE INDEX "WorkOrderExecutor_personId_idx" ON "WorkOrderExecutor"("personId");

-- AddForeignKey
ALTER TABLE "WorkOrderExecutor" ADD CONSTRAINT "WorkOrderExecutor_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderExecutor" ADD CONSTRAINT "WorkOrderExecutor_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
