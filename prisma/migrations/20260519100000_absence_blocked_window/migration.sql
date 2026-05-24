-- Optional forbidden time window within the workday (solver uses overlap with work windows).
ALTER TABLE "Absence" ADD COLUMN "blockStartMinutes" INTEGER;
ALTER TABLE "Absence" ADD COLUMN "blockEndMinutes" INTEGER;
