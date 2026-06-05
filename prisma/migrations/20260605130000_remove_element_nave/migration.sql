-- Nave assignment is handled at task level, not per lamp element or catalog default.

ALTER TABLE "LampElement" DROP CONSTRAINT IF EXISTS "LampElement_naveId_fkey";
ALTER TABLE "LampElement" DROP COLUMN IF EXISTS "naveId";

ALTER TABLE "ElementType" DROP CONSTRAINT IF EXISTS "ElementType_defaultNaveId_fkey";
ALTER TABLE "ElementType" DROP COLUMN IF EXISTS "defaultNaveId";
