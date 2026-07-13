-- AlterTable
ALTER TABLE "ElementTypologyNave" ADD COLUMN "imageData" BYTEA,
ADD COLUMN "imageMimeType" TEXT,
ADD COLUMN "imageUpdatedAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "ProjectApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'PARTIAL_APPROVAL', 'IN_PRODUCTION');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "approvalStatus" "ProjectApprovalStatus" NOT NULL DEFAULT 'IN_PRODUCTION';

-- AlterTable
ALTER TABLE "Lamp" ADD COLUMN "isApprovedForPlanning" BOOLEAN NOT NULL DEFAULT true;
