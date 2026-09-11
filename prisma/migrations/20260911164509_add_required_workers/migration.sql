-- AlterTable
ALTER TABLE "ElementTypeProcess" ADD COLUMN     "requiredWorkers" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "requiredWorkers" INTEGER NOT NULL DEFAULT 1;
