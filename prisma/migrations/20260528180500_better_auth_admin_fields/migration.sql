-- Better Auth admin plugin fields (ban + impersonation).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banExpires" TIMESTAMP(3);

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "impersonatedBy" TEXT;
