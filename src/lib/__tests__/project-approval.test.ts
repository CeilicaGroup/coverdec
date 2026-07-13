import { describe, expect, it } from "vitest";
import { ProjectApprovalStatus } from "@/generated/prisma";
import {
  isLampEligibleForPlanning,
  isProjectExcludedFromPlanning,
  lampApprovalForProjectStatus,
} from "@/lib/project-approval";

describe("project-approval", () => {
  it("excludes pending approval projects from planning", () => {
    expect(
      isProjectExcludedFromPlanning(ProjectApprovalStatus.PENDING_APPROVAL),
    ).toBe(true);
    expect(
      isProjectExcludedFromPlanning(ProjectApprovalStatus.PARTIAL_APPROVAL),
    ).toBe(false);
    expect(
      isProjectExcludedFromPlanning(ProjectApprovalStatus.IN_PRODUCTION),
    ).toBe(false);
  });

  it("includes all lamps in production projects", () => {
    expect(
      isLampEligibleForPlanning({
        projectApprovalStatus: ProjectApprovalStatus.IN_PRODUCTION,
        lampApproved: false,
      }),
    ).toBe(true);
  });

  it("excludes pending approval projects regardless of lamp flag", () => {
    expect(
      isLampEligibleForPlanning({
        projectApprovalStatus: ProjectApprovalStatus.PENDING_APPROVAL,
        lampApproved: true,
      }),
    ).toBe(false);
  });

  it("requires lamp approval in partial approval projects", () => {
    expect(
      isLampEligibleForPlanning({
        projectApprovalStatus: ProjectApprovalStatus.PARTIAL_APPROVAL,
        lampApproved: true,
      }),
    ).toBe(true);
    expect(
      isLampEligibleForPlanning({
        projectApprovalStatus: ProjectApprovalStatus.PARTIAL_APPROVAL,
        lampApproved: false,
      }),
    ).toBe(false);
  });

  it("maps lamp flags when approval status changes", () => {
    expect(
      lampApprovalForProjectStatus(ProjectApprovalStatus.IN_PRODUCTION),
    ).toBe(true);
    expect(
      lampApprovalForProjectStatus(ProjectApprovalStatus.PARTIAL_APPROVAL),
    ).toBe(false);
    expect(
      lampApprovalForProjectStatus(ProjectApprovalStatus.PENDING_APPROVAL),
    ).toBe(false);
  });
});
