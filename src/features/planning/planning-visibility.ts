import { PlanningStatus, Role } from "@/generated/prisma";
import { formatShortDate } from "@/lib/format";

export const PLANNING_VIEW_MODE_COOKIE = "planning-view-mode";

export type PlanningViewMode = "published_only" | "include_draft";

const VIEW_MODE_VALUES = new Set<PlanningViewMode>([
  "published_only",
  "include_draft",
]);

export function parsePlanningViewModeCookie(
  value: string | undefined,
): PlanningViewMode | undefined {
  if (!value) return undefined;
  return VIEW_MODE_VALUES.has(value as PlanningViewMode)
    ? (value as PlanningViewMode)
    : undefined;
}

export function resolvePlanningViewMode(
  role: Role,
  adminPreference?: PlanningViewMode,
): PlanningViewMode {
  if (role === Role.OPERARIO || role === Role.JEFE_PRODUCCION) {
    return "published_only";
  }
  return adminPreference ?? "published_only";
}

export function planningStatusFilter(
  viewMode: PlanningViewMode,
): { status: PlanningStatus } | undefined {
  if (viewMode === "published_only") {
    return { status: PlanningStatus.PUBLISHED };
  }
  return undefined;
}

export function isPlanningVisible(
  status: PlanningStatus,
  viewMode: PlanningViewMode,
): boolean {
  if (viewMode === "include_draft") return true;
  return status === PlanningStatus.PUBLISHED;
}

/** Solo admin puede activar la vista «+ borrador». */
export function roleCanIncludeDraftView(role: Role): boolean {
  return role === Role.ADMIN;
}

/** Generar, publicar, deshacer, pesos y estrategia de planning. */
export function canManagePlanning(role: Role): boolean {
  return role === Role.ADMIN;
}

export function resolvePlanningEmptyNotice(
  role: Role,
  args: {
    viewMode: PlanningViewMode;
    planning: unknown | null | undefined;
    planningMeta: { status: PlanningStatus } | null | undefined;
  },
): { hiddenDraft: boolean; noPublished: boolean } {
  const hiddenDraft =
    args.viewMode === "published_only" &&
    args.planningMeta?.status === PlanningStatus.DRAFT &&
    !args.planning;
  const noPublished =
    args.viewMode === "published_only" && !args.planningMeta && !args.planning;
  return planningNoticeState(role, { hiddenDraft, noPublished });
}

export function resolvePlanningStatusKpi(args: {
  role: Role;
  viewMode: PlanningViewMode;
  planning: { status: PlanningStatus; publishedAt: Date | null } | null | undefined;
  planningMeta: { status: PlanningStatus; publishedAt: Date | null } | null | undefined;
}): {
  value: string;
  sub: string;
  highlight: "ok" | "muted";
  showCheckIcon: boolean;
} {
  const planning = args.planning ?? null;
  const meta = args.planningMeta ?? null;
  const isPublished =
    planning?.status === PlanningStatus.PUBLISHED ||
    meta?.status === PlanningStatus.PUBLISHED;

  if (isPublished) {
    const publishedAt = planning?.publishedAt ?? meta?.publishedAt ?? null;
    return {
      value: "Publicado",
      sub: publishedAt ? formatShortDate(publishedAt) : "",
      highlight: "ok",
      showCheckIcon: true,
    };
  }

  const hasDraft =
    planning?.status === PlanningStatus.DRAFT ||
    meta?.status === PlanningStatus.DRAFT;

  if (args.role === Role.ADMIN && hasDraft) {
    return {
      value: "Borrador",
      sub:
        !planning &&
        meta?.status === PlanningStatus.DRAFT &&
        args.viewMode === "published_only"
          ? "Borrador oculto en vista"
          : "Genera para empezar",
      highlight: "muted",
      showCheckIcon: true,
    };
  }

  return {
    value: "Sin generar",
    sub: "Genera para empezar",
    highlight: "muted",
    showCheckIcon: false,
  };
}

/** Operarios y jefes no deben saber que existe un borrador oculto. */
export function planningNoticeState(
  role: Role,
  input: { hiddenDraft: boolean; noPublished: boolean },
): { hiddenDraft: boolean; noPublished: boolean } {
  if (
    (role === Role.OPERARIO || role === Role.JEFE_PRODUCCION) &&
    input.hiddenDraft
  ) {
    return { hiddenDraft: false, noPublished: true };
  }
  return input;
}
