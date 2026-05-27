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
  type ActualHourEntry,
} from "@/features/planning/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { PersonAvatar } from "@/components/person-avatar";
import {
  ProcessBadge,
  processColor,
  type ProcessBadgeStyle,
} from "@/components/process-badge";
import { rangeLabel, slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import { toIsoUtcFromDateAndHour } from "@/lib/datetime-local";
import { formatDayMonthYear, formatHours, formatTimeRangeFromStartAndHours } from "@/lib/format";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";
import { TaskLampBastidor } from "@/components/task-lamp-bastidor";
import { getTaskLampFrameLabel } from "@/features/planning/task-lamp-frame";
import { Role } from "@/generated/prisma";
import { TaskProgressActionsPanel } from "@/features/time-tracking/task-progress-actions-panel";
import { formatActualEntrySummaryLabel } from "@/features/time-tracking/entry-label";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

interface GridCell {
  id: string;
  taskId: string | null;
  isTaskCompleted: boolean;
  userId: string | null;
  personId: string | null;
  projectId: string | null;
  lampId: string | null;
  hours: number;
  startSlot: number | null;
  endSlot: number | null;
  /** Overrides slot-derived label for actual entries: "HH:MM–HH:MM" */
  timeLabel: string | null;
  isRunning: boolean;
  process: string;
  project: string;
  lamp: string | null;
  bastidor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
}

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
  const actualRunningByTask =
    view === "actual" ? new Map<string, boolean>() : new Map<string, boolean>();
  for (const [personId, runningByTask] of actualTask.runningByPersonTask) {
    for (const [taskId, isRunning] of runningByTask) {
      if (isRunning) actualRunningByTask.set(taskId, true);
    }
  }
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
          <div className="grid min-w-[960px]" style={{ gridTemplateColumns: "180px repeat(5, 1fr)" }}>
            <div className="bg-muted px-3 py-2 text-xs font-semibold border-b border-r">
              Operario
            </div>
            {days.map((d, idx) => {
              const isHoliday = holidayDates.has(d.toISOString().slice(0, 10));
              return (
                <div
                  key={d.toISOString()}
                  className="bg-muted px-3 py-2 text-xs font-semibold text-center border-b border-r last:border-r-0"
                >
                  {DAY_LABELS[idx]}
                  <div className="text-[10px] text-muted-foreground">
                    {formatDayMonthYear(d)}
                  </div>
                  {isHoliday && (
                    <div className="text-[10px] text-orange-600 font-bold mt-0.5">Festivo</div>
                  )}
                </div>
              );
            })}

            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                view={view}
                days={days}
                cells={grid.get(person.id) ?? new Map()}
                plannedHoursByTask={planTask.hoursByPersonTask.get(person.id) ?? new Map()}
                plannedDueHoursByTask={planTask.dueHoursByPersonTask.get(person.id) ?? new Map()}
                actualHoursByTask={actualTask.hoursByPersonTask.get(person.id) ?? new Map()}
                plannedItemsByTask={planTask.itemsByPersonTask.get(person.id) ?? new Map()}
                actualItemsByTask={actualTask.itemsByPersonTask.get(person.id) ?? new Map()}
                actualRunningByTask={actualTask.runningByPersonTask.get(person.id) ?? new Map()}
                completedByTask={actualTask.completedByPersonTask.get(person.id) ?? new Map()}
                absences={absences.filter((a) => a.personId === person.id)}
                processStyles={processStyles}
                canEditEntries={ctx.role === Role.ADMIN}
                entriesByPersonDayTask={entriesByPersonDayTask}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PersonRow({
  person,
  view,
  days,
  cells,
  plannedHoursByTask,
  plannedDueHoursByTask,
  actualHoursByTask,
  plannedItemsByTask,
  actualItemsByTask,
  actualRunningByTask,
  completedByTask,
  absences,
  processStyles,
  canEditEntries,
  entriesByPersonDayTask,
}: {
  person: { id: string; nombre: string; iniciales: string; color: string };
  view: "plan" | "actual";
  days: Date[];
  cells: Map<string, GridCell[]>;
  plannedHoursByTask: Map<string, number>;
  plannedDueHoursByTask: Map<string, number>;
  actualHoursByTask: Map<string, number>;
  plannedItemsByTask: Map<string, { id: string; label: string }[]>;
  actualItemsByTask: Map<string, { id: string; label: string }[]>;
  actualRunningByTask: Map<string, boolean>;
  completedByTask: Map<string, boolean>;
  absences: { date: Date; reason: string | null }[];
  processStyles: Map<string, ProcessBadgeStyle>;
  canEditEntries: boolean;
  entriesByPersonDayTask: Map<
    string,
    {
      id: string;
      startedAt: string;
      endedAt: string;
      notes: string | null;
      summaryLabel: string;
      dateIso: string;
      hours: number;
      process: string | null;
      isRunning: boolean;
    }[]
  >;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-r flex items-center gap-2 bg-card">
        <PersonAvatar iniciales={person.iniciales} color={person.color} size={24} />
        <div className="overflow-hidden">
          <div className="text-xs font-semibold truncate">{person.nombre}</div>
        </div>
      </div>
      {days.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const tasks = cells.get(key) ?? [];
        const isAbsent = absences.some(
          (a) => a.date.toISOString().slice(0, 10) === key,
        );
        return (
          <div
            key={key}
            className="border-b border-r last:border-r-0 px-1.5 py-1.5 min-h-[80px] space-y-1 bg-card"
          >
            {isAbsent ? (
              <div className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground text-center">
                Ausencia
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded border border-dashed px-2 py-1 text-[10px] text-muted-foreground text-center">
                Libre
              </div>
            ) : (
              tasks.map((t) => {
                const colors = processColor(t.process, processStyles.get(t.process));
                const planned = t.taskId ? (plannedHoursByTask.get(t.taskId) ?? 0) : 0;
                const plannedDue = t.taskId ? (plannedDueHoursByTask.get(t.taskId) ?? 0) : 0;
                const actual = t.taskId ? (actualHoursByTask.get(t.taskId) ?? 0) : 0;
                const stripes: ProgressStripe[] =
                  t.taskId
                    ? view === "actual"
                      ? (plannedItemsByTask.get(t.taskId) ?? []).map((x) => ({
                          id: `plan-${x.id}`,
                          label: x.label,
                          kind: "plan" as const,
                        }))
                      : t.startSlot != null && t.endSlot != null
                        ? [
                            {
                              id: `plan-${t.id}`,
                              label: `${key} · ${rangeLabel(t.startSlot, t.endSlot)} · ${formatHours(t.hours)} · ${t.process}`,
                              kind: "plan" as const,
                            },
                          ]
                        : []
                    : [];
                const hasRunning = t.taskId
                  ? (actualRunningByTask.get(t.taskId) ?? false)
                  : false;
                const dayDate = new Date(`${key}T00:00:00Z`);
                const planStartedAt =
                  t.startSlot != null
                    ? toIsoUtcFromDateAndHour(dayDate, slotToHour(t.startSlot))
                    : `${key}T08:00:00.000Z`;
                const planEndedAt =
                  t.endSlot != null
                    ? toIsoUtcFromDateAndHour(dayDate, slotEndToHour(t.endSlot))
                    : `${key}T09:00:00.000Z`;
                const startedAt =
                  view === "actual" && t.startedAt ? t.startedAt : planStartedAt;
                const endedAt =
                  view === "actual" && t.endedAt ? t.endedAt : planEndedAt;
                const cellEntries =
                  t.taskId != null
                    ? (entriesByPersonDayTask.get(`${person.id}|${key}|${t.taskId}`) ?? [])
                    : [];
                return (
                  <div
                    key={t.id}
                    className="rounded px-1.5 py-1 border-l-[3px] text-[10px] leading-tight"
                    style={{
                      background: colors.bgColor,
                      borderColor: colors.borderColor,
                    }}
                  >
                    {(t.timeLabel ?? (t.startSlot !== null && t.endSlot !== null ? rangeLabel(t.startSlot, t.endSlot) : null)) && (
                      <div className="font-mono text-[9px] opacity-70">
                        {t.timeLabel ?? rangeLabel(t.startSlot!, t.endSlot!)}
                      </div>
                    )}
                    <div className="font-semibold truncate" style={{ color: colors.fgColor }}>
                      {t.project}
                    </div>
                    {t.lamp ? (
                      <div className="text-[9px] truncate opacity-80" style={{ color: colors.fgColor }}>
                        {t.lamp}
                      </div>
                    ) : null}
                    <TaskLampBastidor
                      label={t.bastidor}
                      className="text-[9px] opacity-80"
                    />
                    <div className="flex items-center gap-1 mt-0.5">
                      <ProcessBadge
                        code={t.process}
                        definition={processStyles.get(t.process)}
                      />
                      <span
                        className="font-mono text-[9px] font-bold ml-auto"
                        style={{ color: colors.fgColor }}
                      >
                        {formatHours(t.hours)}
                      </span>
                    </div>
                    {t.taskId ? (
                      <TaskProgressInline
                        progress={computeTaskProgress({
                          isCompleted: completedByTask.get(t.taskId) ?? false,
                          plannedHours: planned,
                          plannedDueHours: plannedDue,
                          actualHours: actual,
                          hasRunning,
                        })}
                        stripes={stripes}
                        className="mt-0.5 block"
                        actions={
                          canEditEntries ? (
                            <TaskProgressActionsPanel
                              taskId={t.taskId}
                              isCompleted={completedByTask.get(t.taskId) ?? false}
                              canManageCompletion={canEditEntries}
                              timeEntry={{
                                entries: cellEntries,
                                userId: t.userId ?? undefined,
                                personId: t.personId ?? person.id,
                                projectId: t.projectId ?? "",
                                lampId: t.lampId ?? undefined,
                                taskId: t.taskId,
                                process: t.process,
                                startedAt,
                                endedAt,
                                defaultStartedAt: planStartedAt,
                                defaultEndedAt: planEndedAt,
                                notes: t.notes,
                                canEdit: canEditEntries,
                                canCreate: canEditEntries,
                                canDelete: canEditEntries,
                              }}
                            />
                          ) : null
                        }
                      />
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </>
  );
}

function buildEntriesByPersonDayTask(entries: ActualHourEntry[]) {
  const map = new Map<
    string,
    {
      id: string;
      startedAt: string;
      endedAt: string;
      notes: string | null;
      summaryLabel: string;
      dateIso: string;
      hours: number;
      process: string | null;
      isRunning: boolean;
    }[]
  >();
  for (const e of entries) {
    if (!e.personId || !e.taskId || !e.endedAt) continue;
    const key = `${e.personId}|${e.date}|${e.taskId}`;
    const list = map.get(key) ?? [];
    list.push({
      id: e.id,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt.toISOString(),
      notes: e.notes,
      summaryLabel: formatActualEntrySummaryLabel(
        e.date,
        e.hours,
        e.process ?? e.task?.process,
      ),
      dateIso: e.date,
      hours: e.hours,
      process: e.process ?? e.task?.process ?? null,
      isRunning: e.isRunning,
    });
    map.set(key, list);
  }
  return map;
}

function buildPlanGrid(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  days: Date[],
): Map<string, Map<string, GridCell[]>> {
  const grid = new Map<string, Map<string, GridCell[]>>();
  for (const p of people) {
    const personMap = new Map<string, GridCell[]>();
    for (const d of days) personMap.set(d.toISOString().slice(0, 10), []);
    grid.set(p.id, personMap);
  }
  if (!planning) return grid;
  for (const a of planning.assignments) {
    const personMap = grid.get(a.personId);
    if (!personMap) continue;
    const key = a.date.toISOString().slice(0, 10);
    const cell = personMap.get(key) ?? [];
    cell.push({
      id: a.id,
      taskId: a.taskId,
      hours: a.hours,
      startSlot: a.startSlot,
      endSlot: a.endSlot,
      timeLabel: null,
      isRunning: false,
      isTaskCompleted: a.task.isCompleted,
      userId: null,
      personId: a.personId,
      projectId: a.task.projectId,
      lampId: a.task.lampId,
      process: a.process,
      project: a.task.project.name,
      lamp: a.task.lamp?.name ?? null,
      bastidor: getTaskLampFrameLabel(a.task),
      startedAt: null,
      endedAt: null,
      notes: null,
    });
    personMap.set(key, cell);
  }
  return grid;
}

function buildActualGrid(
  entries: ActualHourEntry[],
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  days: Date[],
): Map<string, Map<string, GridCell[]>> {
  const grid = new Map<string, Map<string, GridCell[]>>();
  for (const p of people) {
    const personMap = new Map<string, GridCell[]>();
    for (const d of days) personMap.set(d.toISOString().slice(0, 10), []);
    grid.set(p.id, personMap);
  }
  for (const e of entries) {
    if (!e.personId) continue;
    const personMap = grid.get(e.personId);
    if (!personMap) continue;
    const cell = personMap.get(e.date) ?? [];
    cell.push({
      id: e.id,
      taskId: e.taskId,
      hours: e.hours,
      startSlot: null,
      endSlot: null,
      timeLabel: formatTimeRangeFromStartAndHours(e.startedAt, e.hours),
      isRunning: e.isRunning,
      isTaskCompleted: e.task?.isCompleted ?? false,
      userId: e.userId,
      personId: e.personId,
      projectId: e.project?.id ?? e.task?.projectId ?? null,
      lampId: e.lamp?.id ?? e.task?.lampId ?? null,
      process: e.process ?? "—",
      project: e.project?.name ?? "—",
      lamp: e.lamp?.name ?? null,
      bastidor: e.task ? getTaskLampFrameLabel(e.task) : null,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString() ?? null,
      notes: e.notes,
    });
    personMap.set(e.date, cell);
  }
  return grid;
}

function buildPersonTaskSummary(
  grid: Map<string, Map<string, GridCell[]>>,
  cutoffIso: string,
) {
  const hoursByPersonTask = new Map<string, Map<string, number>>();
  const dueHoursByPersonTask = new Map<string, Map<string, number>>();
  const itemsByPersonTask = new Map<string, Map<string, { id: string; label: string }[]>>();
  const runningByPersonTask = new Map<string, Map<string, boolean>>();
  const completedByPersonTask = new Map<string, Map<string, boolean>>();
  for (const [personId, dayMap] of grid) {
    const hours = new Map<string, number>();
    const dueHours = new Map<string, number>();
    const items = new Map<string, { id: string; label: string }[]>();
    const running = new Map<string, boolean>();
    const completed = new Map<string, boolean>();
    for (const [date, dayCells] of dayMap) {
      for (const cell of dayCells) {
        if (!cell.taskId) continue;
        hours.set(cell.taskId, (hours.get(cell.taskId) ?? 0) + cell.hours);
        if (date <= cutoffIso) {
          dueHours.set(cell.taskId, (dueHours.get(cell.taskId) ?? 0) + cell.hours);
        }
        const list = items.get(cell.taskId) ?? [];
        const when =
          cell.timeLabel ??
          (cell.startSlot != null && cell.endSlot != null
            ? rangeLabel(cell.startSlot, cell.endSlot)
            : "sin hora");
        list.push({
          id: cell.id,
          label: `${date} · ${when} · ${formatHours(cell.hours)} · ${cell.process}`,
        });
        items.set(cell.taskId, list);
        if (cell.isRunning) running.set(cell.taskId, true);
        if (cell.isTaskCompleted) completed.set(cell.taskId, true);
      }
    }
    hoursByPersonTask.set(personId, hours);
    dueHoursByPersonTask.set(personId, dueHours);
    itemsByPersonTask.set(personId, items);
    runningByPersonTask.set(personId, running);
    completedByPersonTask.set(personId, completed);
  }
  return {
    hoursByPersonTask,
    dueHoursByPersonTask,
    itemsByPersonTask,
    runningByPersonTask,
    completedByPersonTask,
  };
}
