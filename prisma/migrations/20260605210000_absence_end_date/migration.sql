-- DropIndex
DROP INDEX IF EXISTS "Absence_personId_date_key";

-- AlterTable
ALTER TABLE "Absence" ADD COLUMN "endDate" TIMESTAMP(3);

UPDATE "Absence" SET "endDate" = "date" WHERE "endDate" IS NULL;

ALTER TABLE "Absence" ALTER COLUMN "endDate" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Absence_personId_date_endDate_idx" ON "Absence"("personId", "date", "endDate");
