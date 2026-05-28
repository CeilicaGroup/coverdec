-- Better Auth admin plugin fields (ban + impersonation).
ALTER TABLE "User" ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "banReason" TEXT;
ALTER TABLE "User" ADD COLUMN "banExpires" TIMESTAMP(3);

ALTER TABLE "Session" ADD COLUMN "impersonatedBy" TEXT;
