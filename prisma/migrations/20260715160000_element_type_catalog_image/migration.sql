-- Catalog image per ElementType (shared across all lamps using that type).
ALTER TABLE "ElementType" ADD COLUMN "imageData" BYTEA,
ADD COLUMN "imageMimeType" TEXT,
ADD COLUMN "imageUpdatedAt" TIMESTAMP(3);

-- Remove per-lamp-element images (replaced by ElementType catalog images).
ALTER TABLE "LampElement" DROP COLUMN "imageData",
DROP COLUMN "imageMimeType",
DROP COLUMN "imageUpdatedAt";
