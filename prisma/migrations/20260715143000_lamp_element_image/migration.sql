-- AlterTable
ALTER TABLE "LampElement" ADD COLUMN "imageData" BYTEA,
ADD COLUMN "imageMimeType" TEXT,
ADD COLUMN "imageUpdatedAt" TIMESTAMP(3);
