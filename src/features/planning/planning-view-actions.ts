"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import {
  PLANNING_VIEW_MODE_COOKIE,
  type PlanningViewMode,
  parsePlanningViewModeCookie,
} from "@/features/planning/planning-visibility";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function setPlanningViewModeAction(
  mode: PlanningViewMode,
): Promise<{ ok: true; mode: PlanningViewMode }> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  if (!parsePlanningViewModeCookie(mode)) {
    throw new Error("Modo de vista no válido");
  }

  const cookieStore = await cookies();
  cookieStore.set(PLANNING_VIEW_MODE_COOKIE, mode, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  revalidatePath("/dashboard", "layout");
  return { ok: true, mode };
}
