import { ProjectApprovalStatus } from "@/generated/prisma";

export const PROJECT_APPROVAL_STATUS_LABELS: Record<ProjectApprovalStatus, string> = {
  [ProjectApprovalStatus.PENDING_APPROVAL]: "Pendiente de aprobación",
  [ProjectApprovalStatus.PARTIAL_APPROVAL]: "Aprobación parcial",
  [ProjectApprovalStatus.IN_PRODUCTION]: "En producción",
};

export function deriveProjectApprovalStatus(
  lampApprovals: boolean[],
): ProjectApprovalStatus {
  if (lampApprovals.length === 0) {
    return ProjectApprovalStatus.PENDING_APPROVAL;
  }

  const approvedCount = lampApprovals.filter(Boolean).length;
  if (approvedCount === 0) {
    return ProjectApprovalStatus.PENDING_APPROVAL;
  }
  if (approvedCount === lampApprovals.length) {
    return ProjectApprovalStatus.IN_PRODUCTION;
  }
  return ProjectApprovalStatus.PARTIAL_APPROVAL;
}

export function isProjectExcludedFromPlanning(
  approvalStatus: ProjectApprovalStatus,
): boolean {
  return approvalStatus === ProjectApprovalStatus.PENDING_APPROVAL;
}

export function isLampEligibleForPlanning(lampApproved: boolean): boolean {
  return lampApproved;
}
