-- CreateEnum
CREATE TYPE "TaskSystemKind" AS ENUM ('TRANSPORT');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "systemKind" "TaskSystemKind",
ADD COLUMN "transportFromNaveId" TEXT,
ADD COLUMN "transportToNaveId" TEXT,
ADD COLUMN "transportAfterTaskId" TEXT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_transportFromNaveId_fkey" FOREIGN KEY ("transportFromNaveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_transportToNaveId_fkey" FOREIGN KEY ("transportToNaveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ProcessDefinition" (
  "id", "code", "label", "factor", "setupHours", "waitHours",
  "bgColor", "fgColor", "borderColor", "canFragment"
)
SELECT
  gen_random_uuid()::text,
  'TRANSPORTE',
  'Transporte',
  1,
  0.5,
  0,
  '#FEF3C7',
  '#92400E',
  '#D97706',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "ProcessDefinition" WHERE "code" = 'TRANSPORTE'
);
