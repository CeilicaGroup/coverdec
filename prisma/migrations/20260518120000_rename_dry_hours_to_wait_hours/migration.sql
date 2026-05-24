-- Rename dryHours column to waitHours for clarity
ALTER TABLE "ProcessDefinition" RENAME COLUMN "dryHours" TO "waitHours";
