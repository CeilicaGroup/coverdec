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
import { CalendarScaleToggle } from "../../_components/calendar-scale-toggle";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { getPlanningViewModeForContext } from "@/features/planning/planning-view-mode-server";
import { resolvePlanningEmptyNotice } from "@/features/planning/planning-visibility";
import { actualRecordsUserIdForContext } from "@/features/planning/record-visibility";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { Role } from "@/generated/prisma";
import { listAdHocFormOptions, listPendingAdHocTasks } from "@/features/ad-hoc/actions";
import { AdHocTaskDialog } from "../_components/ad-hoc-task-dialog";
import { PendingAdHocTasksPanel } from "../_components/pending-ad-hoc-tasks-panel";
import {
  buildActualGrid,
  buildEntriesByPersonDayTask,
  buildPersonTaskSummary,
  buildPlanGrid,
  WeekPersonGrid,
} from "@/features/planning/week-person-grid";
import { loadTypologyImageAvailability } from "@/features/catalog/typology-images";
import { loadElementTypeImageAvailability } from "@/features/catalog/element-type-images";

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

  const canManageAdHoc =
    ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  const adHocOptions = canManageAdHoc ? await listAdHocFormOptions() : null;

  const [people, holidays, absences, processStyles, planning, actualEntries, planningMeta, typologyImages, elementTypeImages, pendingAdHocTasks] = await Promise.all([
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
      userId: actualRecordsUserIdForContext(ctx),
    }),
    getPlanningWeekMeta({ naveScope, weekStart }),
    loadTypologyImageAvailability(),
    loadElementTypeImageAvailability(),
    canManageAdHoc ? listPendingAdHocTasks(naveScope) : Promise.resolve([]),
  ]);

  const processLabels = Object.fromEntries(
    [...processStyles.entries()].map(([code, style]) => [code, style.label]),
  );

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
  const planningNotice = resolvePlanningEmptyNotice(ctx.role, {
    viewMode,
    planning: view === "plan" ? planning : null,
    planningMeta: view === "plan" ? planningMeta : null,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista semanal S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <div className="grid w-full grid-cols-[auto_auto] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <CalendarScaleToggle
              scale="week"
              weekIso={weekIso}
              monthParam={`${weekIso.slice(0, 7)}-01`}
              view={view}
              monthHidden={ctx.role === Role.OPERARIO}
            />
            <ViewToggle basePath="/dashboard/semana" view={view} week={weekIso} />
            {adHocOptions ? (
              <AdHocTaskDialog options={adHocOptions} />
            ) : null}
            <div className="col-span-2 sm:col-span-1">
              <WeekNav
                weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
                weekIso={weekIso}
              />
            </div>
          </div>
        }
      />
      {view === "plan" && (
        <PlanningEmptyNotice
          hiddenDraft={planningNotice.hiddenDraft}
          noPublished={planningNotice.noPublished}
        />
      )}
      {canManageAdHoc && pendingAdHocTasks.length > 0 ? (
        <PendingAdHocTasksPanel
          tasks={pendingAdHocTasks}
          processLabels={processLabels}
        />
      ) : null}
      {view === "plan" && grid.size === 0 && !planningNotice.hiddenDraft && !planningNotice.noPublished && (
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
            canManageAdHoc={canManageAdHoc}
            recordsPersonId={ctx.role === Role.OPERARIO ? ctx.personId : null}
            entriesByPersonDayTask={entriesByPersonDayTask}
            typologyImages={typologyImages}
            elementTypeImages={elementTypeImages}
          />
        </CardContent>
      </Card>
    </div>
  );
}
