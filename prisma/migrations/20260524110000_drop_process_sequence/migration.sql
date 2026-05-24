-- Drop global sequence from ProcessDefinition; order is defined per frame type
ALTER TABLE "ProcessDefinition" DROP COLUMN "sequence";
