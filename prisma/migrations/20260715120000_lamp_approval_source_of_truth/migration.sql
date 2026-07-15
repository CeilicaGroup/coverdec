-- Derive project approval status from lamp flags (source of truth).
UPDATE "Project" p SET "approvalStatus" = CASE
  WHEN NOT EXISTS (SELECT 1 FROM "Lamp" l WHERE l."projectId" = p.id) THEN 'PENDING_APPROVAL'
  WHEN NOT EXISTS (SELECT 1 FROM "Lamp" l WHERE l."projectId" = p.id AND l."isApprovedForPlanning" = true) THEN 'PENDING_APPROVAL'
  WHEN NOT EXISTS (SELECT 1 FROM "Lamp" l WHERE l."projectId" = p.id AND l."isApprovedForPlanning" = false) THEN 'IN_PRODUCTION'
  ELSE 'PARTIAL_APPROVAL'
END::"ProjectApprovalStatus";

-- New lamps start pending approval until explicitly approved.
ALTER TABLE "Lamp" ALTER COLUMN "isApprovedForPlanning" SET DEFAULT false;
