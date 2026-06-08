import { CalendarDays } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import {
  formatMonthYearEs,
  monthCalendarWeeks,
  monthStartEnd,
  parseMonthParam,
} from "@/lib/civil-date";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import {
  getHolidaysForRange,
  getPlanningForDateRange,
  summarizePlanningByDay,
} from "@/features/planning/queries";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../../_components/page-header";
import { MonthNav } from "../../_components/month-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { CalendarScaleToggle } from "../../_components/calendar-scale-toggle";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { MonthCalendarGrid } from "./month-calendar-grid";
import { getMondayOf } from "@/lib/week";

function civilIsoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export default async function MesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const monthStartIso = parseMonthParam(params.month);
  const { startIso, endIso } = monthStartEnd(monthStartIso);
  const view = params.view === "actual" ? "actual" : "plan";
  const viewMode = await getPlanningViewModeForContext(ctx);
  const naveScope = naveScopeFromContext(ctx);
  const monthLabel = formatMonthYearEs(monthStartIso);
  const monthParam = monthStartIso;

  const rangeStart = civilIsoToUtcDate(startIso);
  const rangeEnd = civilIsoToUtcDate(endIso);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  const [holidays, assignments] = await Promise.all([
    getHolidaysForRange(rangeStart, rangeEnd),
    view === "plan"
      ? getPlanningForDateRange({
          naveScope,
          rangeStart,
          rangeEnd,
          viewMode,
        })
      : Promise.resolve([]),
  ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    rangeStart,
    rangeEnd,
  );
  const summariesByDay =
    view === "plan" ? summarizePlanningByDay(assignments) : new Map();
  const weeks = monthCalendarWeeks(monthStartIso);

  const weekIsoForToggle = getMondayOf(civilIsoToUtcDate(startIso))
    .toISOString()
    .slice(0, 10);

  const hasAnyPlanning = assignments.length > 0;
  const noPublished = view === "plan" && !hasAnyPlanning;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista mensual · ${monthLabel}`}
        description="Resumen de planning por día laborable. Pulsa un día para ver la semana."
        actions={
          <div className="flex items-center gap-2">
            <CalendarScaleToggle
              scale="month"
              weekIso={weekIsoForToggle}
              monthParam={monthParam}
              view={view}
            />
            <ViewToggle
              basePath="/dashboard/mes"
              view={view}
              extraParams={{ month: monthParam.slice(0, 7) }}
            />
            <MonthNav monthLabel={monthLabel} monthParam={monthParam} />
          </div>
        }
      />

      {view === "plan" && (
        <PlanningEmptyNotice hiddenDraft={false} noPublished={noPublished} />
      )}

      {view === "plan" && !hasAnyPlanning && !noPublished && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay planning generado para este mes. Vuelve al Resumen y pulsa «Generar planning».
        </div>
      )}

      {view === "actual" && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          La vista mensual de registros reales estará disponible próximamente. Usa la vista semanal
          para consultar registros por día.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" />
            {view === "plan" ? "Calendario mensual · planning" : "Calendario mensual"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {view === "plan" && (
            <MonthCalendarGrid
              weeks={weeks}
              summariesByDay={summariesByDay}
              holidayDates={holidayDates}
              view={view}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
