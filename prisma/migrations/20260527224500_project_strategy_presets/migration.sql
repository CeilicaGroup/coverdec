-- Add project-level planning strategy controls and nonlinear deadline tuning.
CREATE TYPE "ProjectPlanningPreset" AS ENUM ('A_TIEMPO', 'EQUILIBRADO', 'MIN_COSTE');

ALTER TABLE "PlanningPolicy"
ADD COLUMN "deadlineCurveExponent" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN "overduePenaltyMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN "wPriority" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "Project"
ADD COLUMN "planningPreset" "ProjectPlanningPreset" NOT NULL DEFAULT 'EQUILIBRADO',
ADD COLUMN "planningCostPriority" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN "planningStability" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN "planningDeadlineBoost" INTEGER NOT NULL DEFAULT 50;
