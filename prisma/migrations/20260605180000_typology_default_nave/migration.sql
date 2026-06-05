-- Default nave per element typology (Tela, Bastidor, Iluminación)
CREATE TABLE "ElementTypologyNave" (
  "typology" "ElementTypology" NOT NULL,
  "defaultNaveId" TEXT,
  CONSTRAINT "ElementTypologyNave_pkey" PRIMARY KEY ("typology")
);

INSERT INTO "ElementTypologyNave" ("typology", "defaultNaveId")
SELECT t.typology, (
  SELECT n."id" FROM "Nave" n WHERE n."isActive" = true ORDER BY n."codigo" ASC LIMIT 1
)
FROM (VALUES ('TELA'::"ElementTypology"), ('BASTIDOR'::"ElementTypology"), ('ILUMINACION'::"ElementTypology")) AS t(typology);

ALTER TABLE "ElementTypologyNave" ADD CONSTRAINT "ElementTypologyNave_defaultNaveId_fkey"
  FOREIGN KEY ("defaultNaveId") REFERENCES "Nave"("id") ON DELETE SET NULL ON UPDATE CASCADE;
