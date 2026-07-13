import { ProjectApprovalStatus } from "@/generated/prisma";

export const PROJECT_APPROVAL_STATUS_LABELS: Record<ProjectApprovalStatus, string> = {
  [ProjectApprovalStatus.PENDING_APPROVAL]: "Pendiente de aprobación",
  [ProjectApprovalStatus.PARTIAL_APPROVAL]: "Aprobación parcial",
  [ProjectApprovalStatus.IN_PRODUCTION]: "En producción",
};

export function isProjectExcludedFromPlanning(
  approvalStatus: ProjectApprovalStatus,
): boolean {
  return approvalStatus === ProjectApprovalStatus.PENDING_APPROVAL;
}

export function isLampEligibleForPlanning(args: {
  projectApprovalStatus: ProjectApprovalStatus;
  lampApproved: boolean;
}): boolean {
  if (isProjectExcludedFromPlanning(args.projectApprovalStatus)) return false;
  if (args.projectApprovalStatus === ProjectApprovalStatus.PARTIAL_APPROVAL) {
    return args.lampApproved;
  }
  return true;
}

/** Lamp flags to apply when the project approval status changes. */
export function lampApprovalForProjectStatus(
  approvalStatus: ProjectApprovalStatus,
): boolean {
  return approvalStatus === ProjectApprovalStatus.IN_PRODUCTION;
}
