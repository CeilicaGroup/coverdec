import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import { Role } from "@/generated/prisma";
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
  getHolidaysForRange,
  getLampTaskChains,
  getNavePersonnel,
  getPlanningForWeek,
  getPlanningWeekMeta,
  getProcessBadgeStylesByCode,
  getProcessDefinitionsByCode,
  toPlanningAssignmentSlices,
} from "@/features/planning/queries";
import { formatAbsenceDateLabel } from "@/features/people/absence-display";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { PersonAvatar } from "@/components/person-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours } from "@/lib/format";
import { PrintToolbar } from "./print-toolbar";
import {
  PersonaLayoutToggle,
  parsePersonaLayout,
} from "./persona-layout-toggle";
import {
  getPlanningViewModeForContext,
  planningNoticeState,
} from "@/features/planning/planning-visibility";
import {
  actualRecordsUserIdForContext,
  canSeePersonRecords,
} from "@/features/planning/record-visibility";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import {
  buildActualGrid,
  buildEntriesByPersonDayTask,
  buildPersonTaskSummary,
  buildPlanGrid,
  PersonWeekCalendar,
} from "@/features/planning/week-person-grid";
import { buildPlanningTimeline } from "@/features/planning/planning-timeline";
import {
  PersonWeekList,
  personWeekListTotalHours,
} from "@/features/planning/person-week-list";
import { buildPersonWeekListMaps } from "@/features/planning/person-week-list-maps";

export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string; layout?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const layout = parsePersonaLayout(params.layout);
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);
  const viewMode = await getPlanningViewModeForContext(ctx);
  const naveScope = naveScopeFromContext(ctx);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    people,
    absences,
    holidays,
    processStyles,
    processByCode,
    planning,
    actualEntries,
    lampTaskChains,
    planningMeta,
  ] = await Promise.all([
    getNavePersonnel(naveScope),
    getAbsencesForRange(days[0], days[4]),
    getHolidaysForRange(days[0], days[4]),
    getProcessBadgeStylesByCode(),
    getProcessDefinitionsByCode(),
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
    getLampTaskChains(naveScope),
    getPlanningWeekMeta({ naveScope, weekStart }),
  ]);

  const planningAssignments = toPlanningAssignmentSlices(planning?.assignments ?? []);
  const fullTimeline = buildPlanningTimeline(
    planningAssignments,
    processByCode,
    lampTaskChains,
  );
  const listMaps = buildPersonWeekListMaps(planningAssignments, actualEntries, todayIso);

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
  const planningNotice = planningNoticeState(ctx.role, { hiddenDraft, noPublished });

  const hasCalendarContent = [...grid.values()].some((dayMap) =>
    [...dayMap.values()].some((cells) => cells.length > 0),
  );
  const hasListContent =
    view === "actual"
      ? actualEntries.length > 0
      : planningAssignments.length > 0;
  const hasContent = layout === "calendario" ? hasCalendarContent : hasListContent;

  const description =
    layout === "calendario"
      ? `${formatWeekRange(weekStart)} · Calendario L–V por operario · imprimir para reparto en nave`
      : `${formatWeekRange(weekStart)} · Lista detallada por operario · imprimir para reparto en nave`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por persona · S${week} · ${year}`}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2 no-print">
            <PersonaLayoutToggle
              basePath="/dashboard/persona"
              layout={layout}
              view={view}
              week={weekIso}
            />
            <ViewToggle
              basePath="/dashboard/persona"
              view={view}
              week={weekIso}
              extraParams={{ layout }}
            />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
            <PrintToolbar />
          </div>
        }
      />

      {view === "plan" && (
        <PlanningEmptyNotice
          hiddenDraft={planningNotice.hiddenDraft}
          noPublished={planningNotice.noPublished}
        />
      )}
      {view === "plan" && !hasContent && !planningNotice.hiddenDraft && !planningNotice.noPublished && (
        <p className="text-sm text-muted-foreground">
          {ctx.role === Role.OPERARIO
            ? "No hay planning publicado para esta semana."
            : "No hay planning para esta semana. Genera un borrador desde Resumen."}
        </p>
      )}
      {view === "actual" && !hasContent && (
        <p className="text-sm text-muted-foreground">
          No hay registros de horas para esta semana.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-4 print:grid-cols-1">
        {people.map((person) => {
          const personAbsences = absences.filter((a) => a.personId === person.id);
          const canSeeRecords = canSeePersonRecords(ctx, person.id);
          const total =
            layout === "calendario"
              ? [...(grid.get(person.id) ?? new Map()).values()]
                  .flat()
                  .reduce((acc, cell) => acc + cell.hours, 0)
              : personWeekListTotalHours(view, person.id, fullTimeline, actualEntries);

          return (
            <PersonCard
              key={person.id}
              person={person}
              total={total}
              absences={personAbsences}
              paddedContent={layout === "calendario"}
            >
              {layout === "calendario" ? (
                <PersonWeekCalendar
                  personId={person.id}
                  view={view}
                  days={days}
                  cells={grid.get(person.id) ?? new Map()}
                  holidayDates={holidayDates}
                  absences={personAbsences}
                  plannedHoursByTask={planTask.hoursByPersonTask.get(person.id) ?? new Map()}
                  plannedDueHoursByTask={planTask.dueHoursByPersonTask.get(person.id) ?? new Map()}
                  actualHoursByTask={actualTask.hoursByPersonTask.get(person.id) ?? new Map()}
                  plannedItemsByTask={planTask.itemsByPersonTask.get(person.id) ?? new Map()}
                  actualRunningByTask={actualTask.runningByPersonTask.get(person.id) ?? new Map()}
                  completedByTask={actualTask.completedByPersonTask.get(person.id) ?? new Map()}
                  processStyles={processStyles}
                  canEditEntries={ctx.role === Role.ADMIN}
                  canSeeRecords={canSeeRecords}
                  entriesByPersonDayTask={entriesByPersonDayTask}
                />
              ) : (
                <PersonWeekList
                  view={view}
                  personId={person.id}
                  fullTimeline={fullTimeline}
                  actualEntries={actualEntries}
                  processByCode={processByCode}
                  maps={listMaps}
                  canSeeRecords={canSeeRecords}
                  canManageCompletion={ctx.role === Role.ADMIN}
                />
              )}
            </PersonCard>
          );
        })}
      </div>
    </div>
  );
}

function PersonCard({
  person,
  total,
  absences,
  children,
  paddedContent = false,
}: {
  person: { id: string; nombre: string; iniciales: string; color: string; notes?: string | null };
  total: number;
  absences: { date: Date; endDate: Date }[];
  children: React.ReactNode;
  paddedContent?: boolean;
}) {
  return (
    <Card className="break-inside-avoid print:border print:shadow-none">
      <CardHeader
        className="flex flex-row items-center gap-3 py-3"
        style={{
          background: person.color,
          color: "white",
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        }}
      >
        <PersonAvatar
          iniciales={person.iniciales}
          color={person.color}
          size={32}
          className="ring-2 ring-white/70"
        />
        <div className="flex-1">
          <CardTitle className="text-white text-base">{person.nombre}</CardTitle>
          <div className="text-[11px] text-white/80">{person.notes ?? ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-white/70">Semana</div>
          <div className="font-bold text-white">{formatHours(total)}</div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {absences.length > 0 && (
          <div className="px-3 py-2 text-xs bg-muted border-b">
            Ausencias:{" "}
            {absences.map((a) => formatAbsenceDateLabel(a)).join(", ")}
          </div>
        )}
        {paddedContent ? <div className="p-3">{children}</div> : children}
      </CardContent>
    </Card>
  );
}
