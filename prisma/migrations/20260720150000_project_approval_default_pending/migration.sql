-- Lamps are the source of truth; project approval must reflect lamp flags.
UPDATE "Project" p SET "approvalStatus" = CASE
  WHEN NOT EXISTS (SELECT 1 FROM "Lamp" l WHERE l."projectId" = p.id) THEN 'PENDING_APPROVAL'
  WHEN NOT EXISTS (SELECT 1 FROM "Lamp" l WHERE l."projectId" = p.id AND l."isApprovedForPlanning" = true) THEN 'PENDING_APPROVAL'
  WHEN NOT EXISTS (SELECT 1 FROM "Lamp" l WHERE l."projectId" = p.id AND l."isApprovedForPlanning" = false) THEN 'IN_PRODUCTION'
  ELSE 'PARTIAL_APPROVAL'
END::"ProjectApprovalStatus";

ALTER TABLE "Project" ALTER COLUMN "approvalStatus" SET DEFAULT 'PENDING_APPROVAL';
