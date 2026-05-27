import { CalendarDays } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import {
  getAbsencesForRange,
  getActualHoursForWeek,
  getNavePersonnel,
  getHolidaysForRange,
  getPlanningForWeek,
  getPlanningWeekMeta,
  getProcessBadgeStylesByCode,
} from "@/features/planning/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { Role } from "@/generated/prisma";
import {
  buildActualGrid,
  buildEntriesByPersonDayTask,
  buildPersonTaskSummary,
  buildPlanGrid,
  WeekPersonGrid,
} from "@/features/planning/week-person-grid";

export default async function SemanaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);
  const viewMode = await getPlanningViewModeForContext(ctx);
  const naveScope = naveScopeFromContext(ctx);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [people, holidays, absences, processStyles, planning, actualEntries, planningMeta] = await Promise.all([
    getNavePersonnel(naveScope),
    getHolidaysForRange(days[0], days[4]),
    getAbsencesForRange(days[0], days[4]),
    getProcessBadgeStylesByCode(),
    getPlanningForWeek({
      naveScope,
      weekStart,
      viewMode,
    }),
    getActualHoursForWeek({
      naveScope,
      weekStart,
    }),
    getPlanningWeekMeta({ naveScope, weekStart }),
  ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    days[0],
    days[days.length - 1] ?? days[0],
  );

  const planGrid = buildPlanGrid(planning, people, days);
  const actualGrid = buildActualGrid(actualEntries, people, days);
  const grid = view === "actual" ? actualGrid : planGrid;
  const planTask = buildPersonTaskSummary(planGrid, todayIso);
  const actualTask = buildPersonTaskSummary(actualGrid, todayIso);
  const entriesByPersonDayTask = buildEntriesByPersonDayTask(actualEntries);
  const hiddenDraft =
    view === "plan" &&
    viewMode === "published_only" &&
    planningMeta?.status === "DRAFT" &&
    !planning;
  const noPublished =
    view === "plan" &&
    viewMode === "published_only" &&
    !planningMeta &&
    !planning;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista semanal S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle basePath="/dashboard/semana" view={view} week={weekIso} />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
          </div>
        }
      />
      {view === "plan" && (
        <PlanningEmptyNotice hiddenDraft={hiddenDraft} noPublished={noPublished} />
      )}
      {view === "plan" && grid.size === 0 && !hiddenDraft && !noPublished && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay planning generado para esta semana. Vuelve al Resumen y pulsa "Generar planning".
        </div>
      )}
      {view === "actual" && [...grid.values()].every((dm) => [...dm.values()].every((c) => c.length === 0)) && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay registros de horas para esta semana.
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" />
            {view === "actual" ? "Registros reales · persona × día" : "Grid semanal · persona × día"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <WeekPersonGrid
            bare
            view={view}
            people={people}
            days={days}
            grid={grid}
            planTask={planTask}
            actualTask={actualTask}
            holidayDates={holidayDates}
            absences={absences}
            processStyles={processStyles}
            canEditEntries={ctx.role === Role.ADMIN}
            entriesByPersonDayTask={entriesByPersonDayTask}
          />
        </CardContent>
      </Card>
    </div>
  );
}
