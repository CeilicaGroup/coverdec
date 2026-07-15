import { describe, expect, it } from "vitest";
import { ProjectApprovalStatus } from "@/generated/prisma";
import {
  deriveProjectApprovalStatus,
  isLampEligibleForPlanning,
  isProjectExcludedFromPlanning,
} from "@/lib/project-approval";

describe("project-approval", () => {
  describe("deriveProjectApprovalStatus", () => {
    it("returns pending when there are no lamps", () => {
      expect(deriveProjectApprovalStatus([])).toBe(
        ProjectApprovalStatus.PENDING_APPROVAL,
      );
    });

    it("returns pending when all lamps are pending", () => {
      expect(deriveProjectApprovalStatus([false, false, false])).toBe(
        ProjectApprovalStatus.PENDING_APPROVAL,
      );
    });

    it("returns in production when all lamps are approved", () => {
      expect(deriveProjectApprovalStatus([true, true])).toBe(
        ProjectApprovalStatus.IN_PRODUCTION,
      );
    });

    it("returns partial approval when lamps are mixed", () => {
      expect(deriveProjectApprovalStatus([true, false])).toBe(
        ProjectApprovalStatus.PARTIAL_APPROVAL,
      );
    });
  });

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

  it("includes only approved lamps in planning", () => {
    expect(isLampEligibleForPlanning(true)).toBe(true);
    expect(isLampEligibleForPlanning(false)).toBe(false);
  });
});
