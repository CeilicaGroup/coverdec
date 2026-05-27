-- CreateTable
CREATE TABLE "PersonNave" (
    "personId" TEXT NOT NULL,
    "naveId" TEXT NOT NULL,

    CONSTRAINT "PersonNave_pkey" PRIMARY KEY ("personId","naveId")
);

-- Migrate from Person.naveId
INSERT INTO "PersonNave" ("personId", "naveId")
SELECT "id", "naveId" FROM "Person";

-- Migrate from User.naveId where linked person missing that nave
INSERT INTO "PersonNave" ("personId", "naveId")
SELECT u."personId", u."naveId"
FROM "User" u
WHERE u."personId" IS NOT NULL
  AND u."naveId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- DropForeignKey
ALTER TABLE "Person" DROP CONSTRAINT "Person_naveId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_naveId_fkey";

-- AlterTable
ALTER TABLE "Person" DROP COLUMN "naveId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "naveId";

-- CreateIndex
CREATE INDEX "PersonNave_naveId_idx" ON "PersonNave"("naveId");

-- AddForeignKey
ALTER TABLE "PersonNave" ADD CONSTRAINT "PersonNave_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonNave" ADD CONSTRAINT "PersonNave_naveId_fkey" FOREIGN KEY ("naveId") REFERENCES "Nave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
