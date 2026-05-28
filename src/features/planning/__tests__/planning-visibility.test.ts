import { describe, expect, it } from "vitest";
import { PlanningStatus, Role } from "@/generated/prisma";
import {
  isPlanningVisible,
  parsePlanningViewModeCookie,
  resolvePlanningViewMode,
} from "@/features/planning/planning-visibility";
import { buildPriorPlanningWhere } from "@/features/planning/prior-week-planning";

describe("planning-visibility", () => {
  it("operario y jefe siempre ven solo publicado", () => {
    expect(
      resolvePlanningViewMode(Role.OPERARIO, "include_draft"),
    ).toBe("published_only");
    expect(
      resolvePlanningViewMode(Role.JEFE_PRODUCCION, "include_draft"),
    ).toBe("published_only");
  });

  it("admin respeta preferencia de cookie", () => {
    expect(resolvePlanningViewMode(Role.ADMIN, "include_draft")).toBe(
      "include_draft",
    );
    expect(resolvePlanningViewMode(Role.ADMIN, undefined)).toBe(
      "published_only",
    );
  });

  it("parsea valores de cookie válidos", () => {
    expect(parsePlanningViewModeCookie("include_draft")).toBe("include_draft");
    expect(parsePlanningViewModeCookie("published_only")).toBe(
      "published_only",
    );
    expect(parsePlanningViewModeCookie("invalid")).toBeUndefined();
  });

  it("oculta borrador en modo published_only", () => {
    expect(isPlanningVisible(PlanningStatus.PUBLISHED, "published_only")).toBe(
      true,
    );
    expect(isPlanningVisible(PlanningStatus.DRAFT, "published_only")).toBe(
      false,
    );
    expect(isPlanningVisible(PlanningStatus.DRAFT, "include_draft")).toBe(
      true,
    );
  });
});

describe("buildPriorPlanningWhere", () => {
  it("solo incluye plannings publicados de semanas anteriores", () => {
    const before = new Date("2026-05-13T00:00:00.000Z");
    const where = buildPriorPlanningWhere("nave-1", before);
    expect(where.planning.status).toBe(PlanningStatus.PUBLISHED);
    expect(where.planning.naveId).toBe("nave-1");
    expect(where.planning.weekStart).toEqual({
      lt: new Date("2026-05-11T00:00:00.000Z"),
    });
  });
});
