import { loadActiveNavesOrdered } from "@/features/naves/active-naves";
import { childLogger } from "@/lib/logger";
import type { PlanFrom } from "@/features/planning/plan-from";
import { generatePlanning, type GeneratedPlanning } from "./service";

const log = childLogger({ module: "planning.all-naves" });

export interface NavePlanningResult extends GeneratedPlanning {
  naveId: string;
  naveCodigo: string;
}

export interface GeneratePlanningAllNavesResult {
  perNave: NavePlanningResult[];
  warnings: string[];
  unscheduledHours: number;
  assignmentsCount: number;
  planningIds: string[];
}

export async function generatePlanningAllNaves(args: {
  weekStart: Date;
  replaceDraft?: boolean;
  planFrom?: PlanFrom;
  planFromAt?: Date;
}): Promise<GeneratePlanningAllNavesResult> {
  const naves = await loadActiveNavesOrdered();
  const perNave: NavePlanningResult[] = [];
  const warnings: string[] = [];
  let unscheduledHours = 0;
  let assignmentsCount = 0;

  for (const nave of naves) {
    const result = await generatePlanning({
      naveId: nave.id,
      weekStart: args.weekStart,
      replaceDraft: args.replaceDraft,
      planFrom: args.planFrom,
      planFromAt: args.planFromAt,
    });
    perNave.push({
      ...result,
      naveId: nave.id,
      naveCodigo: nave.codigo,
    });
    warnings.push(...result.warnings);
    unscheduledHours += result.unscheduledHours;
    assignmentsCount += result.assignmentsCount;
    log.info(
      {
        naveId: nave.id,
        naveCodigo: nave.codigo,
        assignmentsCount: result.assignmentsCount,
      },
      "nave planning generated",
    );
  }

  return {
    perNave,
    warnings,
    unscheduledHours,
    assignmentsCount,
    planningIds: perNave.map((p) => p.planningId),
  };
}
