import { Role } from "@/generated/prisma";
import type { DayPlanningSummary } from "@/features/planning/queries";
import type { DashboardContext } from "@/lib/context";

export function actualRecordsUserIdForContext(
  ctx: Pick<DashboardContext, "role" | "userId">,
): string | undefined {
  if (ctx.role === Role.OPERARIO) {
    return ctx.userId;
  }
  return undefined;
}

export function canSeePersonRecords(
  ctx: Pick<DashboardContext, "role" | "personId">,
  personId: string,
): boolean {
  if (ctx.role === Role.OPERARIO) {
    return ctx.personId != null && ctx.personId === personId;
  }
  return true;
}

export function enrichActualSummariesWithTeam(
  summariesByDay: Map<string, DayPlanningSummary>,
  teamPeople: Array<{ id: string; iniciales: string; color: string }>,
): Map<string, DayPlanningSummary> {
  if (teamPeople.length === 0) return summariesByDay;

  const enriched = new Map<string, DayPlanningSummary>();
  for (const [iso, summary] of summariesByDay) {
    const hoursByPersonId = new Map(summary.peopleHours.map((p) => [p.id, p.hours]));
    enriched.set(iso, {
      ...summary,
      peopleHours: teamPeople.map((person) => ({
        id: person.id,
        iniciales: person.iniciales,
        color: person.color,
        hours: hoursByPersonId.get(person.id) ?? 0,
      })),
    });
  }
  return enriched;
}
