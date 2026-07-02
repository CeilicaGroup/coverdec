import { loadActiveNavesOrdered } from "@/features/naves/active-naves";
import { assertActiveNavesSchedulableTasksHaveOpenWorkOrder } from "@/features/work-orders/require-for-planning";
import { getMondayOf } from "@/lib/week";
import type { PlanFrom } from "@/features/planning/plan-from";
import {
  generateGlobalPlanning,
  type GenerateGlobalPlanningResult,
  type NavePlanningResult,
} from "./service";

export type { NavePlanningResult, GenerateGlobalPlanningResult as GeneratePlanningAllNavesResult };

export async function generatePlanningAllNaves(args: {
  weekStart: Date;
  replaceDraft?: boolean;
  planFrom?: PlanFrom;
  planFromAt?: Date;
}): Promise<GenerateGlobalPlanningResult> {
  const naves = await loadActiveNavesOrdered();
  const weekStart = getMondayOf(args.weekStart);

  await assertActiveNavesSchedulableTasksHaveOpenWorkOrder({
    naveIds: naves.map((nave) => nave.id),
    weekStart,
    planFromAt: args.planFromAt,
  });

  return generateGlobalPlanning({
    weekStart: args.weekStart,
    replaceDraft: args.replaceDraft,
    planFrom: args.planFrom,
    planFromAt: args.planFromAt,
    naves: naves.map((nave) => ({ id: nave.id, codigo: nave.codigo })),
  });
}
