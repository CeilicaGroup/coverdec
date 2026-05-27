import type { DashboardContext } from "@/lib/context";

export type NaveFilter =
  | { mode: "all" }
  | { mode: "single"; ids: [string] }
  | { mode: "multi"; ids: string[] };

/** Resolves which naves scope dashboard/planning queries for the current user. */
export function resolveNaveFilter(ctx: DashboardContext): NaveFilter {
  if (ctx.role === "ADMIN") {
    if (ctx.naveId) return { mode: "single", ids: [ctx.naveId] };
    return { mode: "all" };
  }
  if (ctx.naveIds.length === 0) return { mode: "multi", ids: [] };
  if (ctx.naveIds.length === 1) return { mode: "single", ids: [ctx.naveIds[0]!] };
  return { mode: "multi", ids: ctx.naveIds };
}

export function naveIdsFromFilter(filter: NaveFilter): string[] | null {
  if (filter.mode === "all") return null;
  return filter.ids;
}

/** `null` = todas las naves (admin sin filtro); `[]` = ninguna; otherwise IDs concretos. */
export function naveScopeFromContext(ctx: DashboardContext): string[] | null {
  if (ctx.role === "ADMIN" && ctx.naveId === null) return null;
  return ctx.naveIds;
}
