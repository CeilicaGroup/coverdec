import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { getMondayOf, isoWeek } from "@/lib/week";
import { PlanningStatus } from "@/generated/prisma";
import { loadActiveNaveIdsOrdered } from "@/features/naves/active-naves";
import { listFuturePlannings } from "@/features/planning/service";
import { hasRegistrosFromWeekAll } from "@/features/planning/planning-registros";

export interface PlanningUndoState {
  canUndo: boolean;
  hasFuturePlannings: boolean;
  futurePlanningWeeks: string[];
  hasPublishedFuture: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
  hasPlanning: boolean;
  anyDraft: boolean;
}

/** Lectura para Server Components (no es server action: no se expone al cliente). */
export async function getPlanningUndoState(
  weekStartIso: string,
): Promise<PlanningUndoState> {
  await requireDashboardContext();
  const weekStart = getMondayOf(new Date(weekStartIso));
  const naveIds = await loadActiveNaveIdsOrdered();
  const { year, week } = isoWeek(weekStart);

  const plannings = await prisma.planning.findMany({
    where: { year, week, naveId: { in: naveIds } },
    select: { id: true, status: true },
  });

  const hasPlanning = plannings.length > 0;
  if (!hasPlanning) {
    return {
      canUndo: false,
      hasFuturePlannings: false,
      futurePlanningWeeks: [],
      hasPublishedFuture: false,
      hasRegistros: false,
      isPublished: false,
      hasPlanning: false,
      anyDraft: false,
    };
  }

  const futureByNave = await Promise.all(
    naveIds.map((naveId) => listFuturePlannings(naveId, weekStart)),
  );
  const futurePlannings = futureByNave.flat();
  const futureWeekSet = new Set(
    futurePlannings.map((p) => p.weekStart.toISOString()),
  );
  const futurePlanningWeeks = [...futureWeekSet].sort();

  const hasRegistros = await hasRegistrosFromWeekAll(naveIds, weekStart);

  return {
    canUndo: !hasRegistros,
    hasFuturePlannings: futurePlannings.length > 0,
    futurePlanningWeeks,
    hasPublishedFuture: futurePlannings.some(
      (p) => p.status === PlanningStatus.PUBLISHED,
    ),
    hasRegistros,
    isPublished: plannings.every((p) => p.status === PlanningStatus.PUBLISHED),
    hasPlanning: true,
    anyDraft: plannings.some((p) => p.status === PlanningStatus.DRAFT),
  };
}
