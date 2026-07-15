import { cookies } from "next/headers";
import type { DashboardContext } from "@/lib/context";
import {
  PLANNING_VIEW_MODE_COOKIE,
  type PlanningViewMode,
  parsePlanningViewModeCookie,
  resolvePlanningViewMode,
} from "@/features/planning/planning-visibility";

export async function getPlanningViewModeForContext(
  ctx: Pick<DashboardContext, "role">,
): Promise<PlanningViewMode> {
  const cookieStore = await cookies();
  const pref = parsePlanningViewModeCookie(
    cookieStore.get(PLANNING_VIEW_MODE_COOKIE)?.value,
  );
  return resolvePlanningViewMode(ctx.role, pref);
}
