-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('PRODUCCION', 'PROTOTIPO', 'PRESUPUESTO');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "kind" "ProjectKind" NOT NULL DEFAULT 'PRODUCCION';

-- AlterTable
ALTER TABLE "Lamp" ALTER COLUMN "elementTypeId" DROP NOT NULL;

-- Insert manual estimation process for prototype/budget lamps
INSERT INTO "ProcessDefinition" ("id", "code", "label", "factor", "setupHours", "waitHours", "bgColor", "fgColor", "borderColor", "canFragment")
VALUES (
  'estimacion_manual',
  'ESTIMACION_MANUAL',
  'Estimación manual',
  1,
  0,
  0,
  '#F3F4F6',
  '#374151',
  '#374151',
  true
)
ON CONFLICT ("code") DO NOTHING;
