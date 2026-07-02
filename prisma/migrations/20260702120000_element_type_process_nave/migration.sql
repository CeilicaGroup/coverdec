-- Nave opcional por proceso en catálogo de elementos (null = hereda del elemento).

ALTER TABLE "ElementTypeProcess" ADD COLUMN "naveId" TEXT;

ALTER TABLE "ElementTypeProcess" ADD CONSTRAINT "ElementTypeProcess_naveId_fkey"
  FOREIGN KEY ("naveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;
