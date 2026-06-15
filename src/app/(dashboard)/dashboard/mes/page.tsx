import { CalendarDays } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import {
  businessDaysInMonth,
  formatMonthYearEs,
  monthCalendarWeeks,
  monthStartEnd,
  parseMonthParam,
} from "@/lib/civil-date";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import {
  countDistinctProjectsInActualEntries,
  countDistinctProjectsInAssignments,
  getActualHoursForDateRange,
  getHolidaysForRange,
  getNavePersonnel,
  getPlanningForDateRange,
  getPlanningsInDateRange,
  summarizeActualByDay,
  summarizeMonthFromDaySummaries,
  summarizePlanningByDay,
  summarizeWeekRowsFromCalendar,
} from "@/features/planning/queries";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import {
  actualRecordsUserIdForContext,
  enrichActualSummariesWithTeam,
} from "@/features/planning/record-visibility";
import { Role } from "@/generated/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../../_components/page-header";
import { MonthNav } from "../../_components/month-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { CalendarScaleToggle } from "../../_components/calendar-scale-toggle";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { MonthCalendarGrid } from "./month-calendar-grid";
import { MonthStatsBar } from "./month-stats-bar";
import { getMondayOf } from "@/lib/week";

function civilIsoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function maxHoursInSummaries(
  summaries: Map<string, { totalHours: number }>,
): number {
  let max = 0;
  for (const summary of summaries.values()) {
    if (summary.totalHours > max) max = summary.totalHours;
  }
  return max;
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
  const todayIso = new Date().toISOString().slice(0, 10);

  const rangeStart = civilIsoToUtcDate(startIso);
  const rangeEnd = civilIsoToUtcDate(endIso);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  const [holidays, assignments, actualEntries, planningsInRange, teamPeople] = await Promise.all([
    getHolidaysForRange(rangeStart, rangeEnd),
    view === "plan"
      ? getPlanningForDateRange({
          naveScope,
          rangeStart,
          rangeEnd,
          viewMode,
        })
      : Promise.resolve([]),
    view === "actual"
      ? getActualHoursForDateRange({
          naveScope,
          rangeStart,
          rangeEnd,
          userId: actualRecordsUserIdForContext(ctx),
        })
      : Promise.resolve([]),
    view === "plan"
      ? getPlanningsInDateRange({
          naveScope,
          rangeStart,
          rangeEnd,
          viewMode,
        })
      : Promise.resolve([]),
    view === "actual" && ctx.role === Role.OPERARIO
      ? getNavePersonnel(naveScope)
      : Promise.resolve([]),
  ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    rangeStart,
    rangeEnd,
  );
  const businessDays = businessDaysInMonth(monthStartIso, holidayDates);
  const weeks = monthCalendarWeeks(monthStartIso);

  const summariesByDayRaw =
    view === "plan"
      ? summarizePlanningByDay(assignments)
      : summarizeActualByDay(actualEntries);
  const summariesByDay =
    view === "actual" && ctx.role === Role.OPERARIO
      ? enrichActualSummariesWithTeam(
          summariesByDayRaw,
          teamPeople.map((p) => ({
            id: p.id,
            iniciales: p.iniciales,
            color: p.color,
          })),
        )
      : summariesByDayRaw;

  const weekRows = summarizeWeekRowsFromCalendar(
    weeks,
    summariesByDay,
    view === "plan" ? planningsInRange : [],
  );

  const monthStats = summarizeMonthFromDaySummaries({
    summariesByDay,
    businessDays: businessDays.length,
    calendarWeeks: weeks.length,
    weeksWithPlanning: planningsInRange.length,
    projectCount:
      view === "plan"
        ? countDistinctProjectsInAssignments(assignments)
        : countDistinctProjectsInActualEntries(actualEntries),
  });

  const maxDayHours = maxHoursInSummaries(summariesByDay);

  const weekIsoForToggle = getMondayOf(civilIsoToUtcDate(startIso))
    .toISOString()
    .slice(0, 10);

  const hasAnyData =
    view === "plan" ? assignments.length > 0 : actualEntries.length > 0;
  const noPublished = view === "plan" && !hasAnyData;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista mensual · ${monthLabel}`}
        description={
          view === "actual"
            ? "Resumen de horas registradas por día laborable. Pulsa un día para abrir la semana."
            : "Resumen de planning por día laborable con carga por operario y proyecto. Pulsa un día para abrir la semana."
        }
        actions={
          <div className="grid w-full grid-cols-[auto_auto] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
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
            <div className="col-span-2 sm:col-span-1">
              <MonthNav monthLabel={monthLabel} monthParam={monthParam} />
            </div>
          </div>
        }
      />

      {view === "plan" && (
        <PlanningEmptyNotice hiddenDraft={false} noPublished={noPublished} />
      )}

      {view === "plan" && !hasAnyData && !noPublished && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay planning generado para este mes. Vuelve al Resumen y pulsa «Generar planning».
        </div>
      )}

      {view === "actual" && !hasAnyData && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay registros de horas en los días laborables de este mes.
        </div>
      )}

      {hasAnyData && <MonthStatsBar stats={monthStats} view={view} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" />
            {view === "plan" ? "Calendario mensual · planning" : "Calendario mensual · registros"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <MonthCalendarGrid
            weeks={weeks}
            summariesByDay={summariesByDay}
            weekRows={weekRows}
            holidayDates={holidayDates}
            view={view}
            todayIso={todayIso}
            maxDayHours={maxDayHours}
          />
        </CardContent>
      </Card>
    </div>
  );
}
