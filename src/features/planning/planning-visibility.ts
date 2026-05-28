import { cookies } from "next/headers";
import { PlanningStatus, Role } from "@/generated/prisma";
import type { DashboardContext } from "@/lib/context";

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

export async function getPlanningViewModeForContext(
  ctx: Pick<DashboardContext, "role">,
): Promise<PlanningViewMode> {
  const cookieStore = await cookies();
  const pref = parsePlanningViewModeCookie(
    cookieStore.get(PLANNING_VIEW_MODE_COOKIE)?.value,
  );
  return resolvePlanningViewMode(ctx.role, pref);
}
