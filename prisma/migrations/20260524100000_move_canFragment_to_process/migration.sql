-- Move canFragment from Task to ProcessDefinition
ALTER TABLE "ProcessDefinition" ADD COLUMN "canFragment" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Task" DROP COLUMN "canFragment";
