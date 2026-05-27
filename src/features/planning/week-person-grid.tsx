import { PersonAvatar } from "@/components/person-avatar";
import {
  ProcessBadge,
  processColor,
  type ProcessBadgeStyle,
} from "@/components/process-badge";
import { TaskLampBastidor } from "@/components/task-lamp-bastidor";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rangeLabel, slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import { getTaskLampFrameLabel } from "@/features/planning/task-lamp-frame";
import {
  getNavePersonnel,
  getPlanningForWeek,
  type ActualHourEntry,
} from "@/features/planning/queries";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { formatActualEntrySummaryLabel } from "@/features/time-tracking/entry-label";
import { TaskProgressActionsPanel } from "@/features/time-tracking/task-progress-actions-panel";
import { toIsoUtcFromDateAndHour } from "@/lib/datetime-local";
import { formatDayMonthYear, formatHours, formatTimeRangeFromStartAndHours } from "@/lib/format";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

export interface WeekGridCell {
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

export interface WeekPersonTaskSummary {
  hoursByPersonTask: Map<string, Map<string, number>>;
  dueHoursByPersonTask: Map<string, Map<string, number>>;
  itemsByPersonTask: Map<string, Map<string, { id: string; label: string }[]>>;
  runningByPersonTask: Map<string, Map<string, boolean>>;
  completedByPersonTask: Map<string, Map<string, boolean>>;
}

export function buildEntriesByPersonDayTask(entries: ActualHourEntry[]) {
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

export function buildPlanGrid(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  days: Date[],
): Map<string, Map<string, WeekGridCell[]>> {
  const grid = new Map<string, Map<string, WeekGridCell[]>>();
  for (const p of people) {
    const personMap = new Map<string, WeekGridCell[]>();
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

export function buildActualGrid(
  entries: ActualHourEntry[],
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  days: Date[],
): Map<string, Map<string, WeekGridCell[]>> {
  const grid = new Map<string, Map<string, WeekGridCell[]>>();
  for (const p of people) {
    const personMap = new Map<string, WeekGridCell[]>();
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

export function buildPersonTaskSummary(
  grid: Map<string, Map<string, WeekGridCell[]>>,
  cutoffIso: string,
): WeekPersonTaskSummary {
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

interface WeekPersonGridProps {
  title?: string;
  bare?: boolean;
  view: "plan" | "actual";
  people: Awaited<ReturnType<typeof getNavePersonnel>>;
  days: Date[];
  grid: Map<string, Map<string, WeekGridCell[]>>;
  planTask: WeekPersonTaskSummary;
  actualTask: WeekPersonTaskSummary;
  holidayDates: Set<string>;
  absences: { personId: string; date: Date; reason: string | null }[];
  processStyles: Map<string, ProcessBadgeStyle>;
  canEditEntries: boolean;
  entriesByPersonDayTask: ReturnType<typeof buildEntriesByPersonDayTask>;
}

export function WeekPersonGrid({
  title,
  bare = false,
  view,
  people,
  days,
  grid,
  planTask,
  actualTask,
  holidayDates,
  absences,
  processStyles,
  canEditEntries,
  entriesByPersonDayTask,
}: WeekPersonGridProps) {
  const gridContent = (
        <div className="grid min-w-[480px]" style={{ gridTemplateColumns: "180px repeat(5, 1fr)" }}>
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
            <WeekPersonRow
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
              canEditEntries={canEditEntries}
              entriesByPersonDayTask={entriesByPersonDayTask}
            />
          ))}
        </div>
  );

  if (bare) return gridContent;

  return (
    <Card>
      {title ? (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className="p-0 overflow-x-auto">{gridContent}</CardContent>
    </Card>
  );
}

function WeekPersonRow({
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
  cells: Map<string, WeekGridCell[]>;
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
  entriesByPersonDayTask: ReturnType<typeof buildEntriesByPersonDayTask>;
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
                    {(t.timeLabel ??
                      (t.startSlot !== null && t.endSlot !== null
                        ? rangeLabel(t.startSlot, t.endSlot)
                        : null)) && (
                      <div className="font-mono text-[9px] opacity-70">
                        {t.timeLabel ?? rangeLabel(t.startSlot!, t.endSlot!)}
                      </div>
                    )}
                    <div className="font-semibold truncate" style={{ color: colors.fgColor }}>
                      {t.project}
                    </div>
                    {t.lamp ? (
                      <div
                        className="text-[9px] truncate opacity-80"
                        style={{ color: colors.fgColor }}
                      >
                        {t.lamp}
                      </div>
                    ) : null}
                    <TaskLampBastidor label={t.bastidor} className="text-[9px] opacity-80" />
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
