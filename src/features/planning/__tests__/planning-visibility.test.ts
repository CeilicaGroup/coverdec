import { describe, expect, it } from "vitest";
import { PlanningStatus, Role } from "@/generated/prisma";
import {
  isPlanningVisible,
  parsePlanningViewModeCookie,
  canManagePlanning,
  planningNoticeState,
  resolvePlanningEmptyNotice,
  resolvePlanningStatusKpi,
  resolvePlanningViewMode,
} from "@/features/planning/planning-visibility";
import { buildPriorPlanningWhere } from "@/features/planning/prior-week-planning";

describe("planning-visibility", () => {
  it("canManagePlanning solo admin", () => {
    expect(canManagePlanning(Role.ADMIN)).toBe(true);
    expect(canManagePlanning(Role.JEFE_PRODUCCION)).toBe(false);
    expect(canManagePlanning(Role.OPERARIO)).toBe(false);
  });

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

  it("operario y jefe no ven aviso de borrador oculto", () => {
    expect(
      planningNoticeState(Role.OPERARIO, {
        hiddenDraft: true,
        noPublished: false,
      }),
    ).toEqual({ hiddenDraft: false, noPublished: true });
    expect(
      planningNoticeState(Role.JEFE_PRODUCCION, {
        hiddenDraft: true,
        noPublished: false,
      }),
    ).toEqual({ hiddenDraft: false, noPublished: true });
    expect(
      planningNoticeState(Role.ADMIN, {
        hiddenDraft: true,
        noPublished: false,
      }),
    ).toEqual({ hiddenDraft: true, noPublished: false });
  });

  it("resolvePlanningEmptyNotice oculta borrador al jefe", () => {
    expect(
      resolvePlanningEmptyNotice(Role.JEFE_PRODUCCION, {
        viewMode: "published_only",
        planning: null,
        planningMeta: { status: PlanningStatus.DRAFT },
      }),
    ).toEqual({ hiddenDraft: false, noPublished: true });
  });

  it("resolvePlanningStatusKpi no muestra borrador al jefe", () => {
    expect(
      resolvePlanningStatusKpi({
        role: Role.JEFE_PRODUCCION,
        viewMode: "published_only",
        planning: null,
        planningMeta: { status: PlanningStatus.DRAFT, publishedAt: null },
      }),
    ).toEqual({
      value: "Sin generar",
      sub: "Genera para empezar",
      highlight: "muted",
      showCheckIcon: false,
    });
  });

  it("resolvePlanningStatusKpi muestra borrador oculto solo a admin", () => {
    expect(
      resolvePlanningStatusKpi({
        role: Role.ADMIN,
        viewMode: "published_only",
        planning: null,
        planningMeta: { status: PlanningStatus.DRAFT, publishedAt: null },
      }).sub,
    ).toBe("Borrador oculto en vista");
  });
});

describe("buildPriorPlanningWhere", () => {
  it("solo incluye plannings publicados de semanas anteriores", () => {
    const before = new Date("2026-05-13T00:00:00.000Z");
    const where = buildPriorPlanningWhere("nave-1", before);
    expect(where.planning).toMatchObject({
      status: PlanningStatus.PUBLISHED,
    });
    expect(where.planning.naveId).toBe("nave-1");
    expect(where.planning.weekStart).toEqual({
      lt: new Date("2026-05-11T00:00:00.000Z"),
    });
  });
});
