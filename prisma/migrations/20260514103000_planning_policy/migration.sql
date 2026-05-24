-- CreateTable
CREATE TABLE "PlanningPolicy" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "wLate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "wUnscheduled" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "wLoadBalance" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "wMove" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanningPolicy_empresaId_key" ON "PlanningPolicy"("empresaId");

-- AddForeignKey
ALTER TABLE "PlanningPolicy" ADD CONSTRAINT "PlanningPolicy_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
