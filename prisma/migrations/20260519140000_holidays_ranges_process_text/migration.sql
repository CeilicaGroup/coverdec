-- Holiday: single date -> inclusive range [startDate, endDate]
DROP INDEX IF EXISTS "Holiday_date_key";

ALTER TABLE "Holiday" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Holiday" ADD COLUMN "endDate" TIMESTAMP(3);

UPDATE "Holiday" SET "startDate" = "date", "endDate" = "date";

ALTER TABLE "Holiday" DROP COLUMN "date";

ALTER TABLE "Holiday" ALTER COLUMN "startDate" SET NOT NULL;
ALTER TABLE "Holiday" ALTER COLUMN "endDate" SET NOT NULL;

CREATE INDEX "Holiday_startDate_endDate_idx" ON "Holiday"("startDate", "endDate");

-- ProcessDefinition: remove per-process weekly deadline
ALTER TABLE "ProcessDefinition" DROP COLUMN IF EXISTS "deadlineDay";

-- Enum ProcessCode -> TEXT on all columns (drop FK that targets ProcessDefinition.code first)
ALTER TABLE "FrameTypeProcess" DROP CONSTRAINT IF EXISTS "FrameTypeProcess_process_fkey";

ALTER TABLE "ProcessDefinition" ALTER COLUMN "code" SET DATA TYPE TEXT USING "code"::TEXT;

ALTER TABLE "PersonSpecialty" ALTER COLUMN "process" SET DATA TYPE TEXT USING "process"::TEXT;
ALTER TABLE "FrameTypeProcess" ALTER COLUMN "process" SET DATA TYPE TEXT USING "process"::TEXT;
ALTER TABLE "Task" ALTER COLUMN "process" SET DATA TYPE TEXT USING "process"::TEXT;
ALTER TABLE "PlanningAssignment" ALTER COLUMN "process" SET DATA TYPE TEXT USING "process"::TEXT;
ALTER TABLE "TimeEntry" ALTER COLUMN "process" SET DATA TYPE TEXT USING "process"::TEXT;
ALTER TABLE "ProductionOrder" ALTER COLUMN "process" SET DATA TYPE TEXT USING "process"::TEXT;

ALTER TABLE "FrameTypeProcess" ADD CONSTRAINT "FrameTypeProcess_process_fkey" FOREIGN KEY ("process") REFERENCES "ProcessDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_process_fkey" FOREIGN KEY ("process") REFERENCES "ProcessDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonSpecialty" ADD CONSTRAINT "PersonSpecialty_process_fkey" FOREIGN KEY ("process") REFERENCES "ProcessDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanningAssignment" ADD CONSTRAINT "PlanningAssignment_process_fkey" FOREIGN KEY ("process") REFERENCES "ProcessDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_process_fkey" FOREIGN KEY ("process") REFERENCES "ProcessDefinition"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_process_fkey" FOREIGN KEY ("process") REFERENCES "ProcessDefinition"("code") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TYPE IF EXISTS "ProcessCode";
