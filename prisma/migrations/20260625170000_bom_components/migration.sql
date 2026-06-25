-- CreateTable
CREATE TABLE "BomComponent" (
    "id" TEXT NOT NULL,
    "elementTypeId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomComponent_elementTypeId_idx" ON "BomComponent"("elementTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "BomComponent_elementTypeId_componentCode_key" ON "BomComponent"("elementTypeId", "componentCode");

-- AddForeignKey
ALTER TABLE "BomComponent" ADD CONSTRAINT "BomComponent_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "ElementType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
