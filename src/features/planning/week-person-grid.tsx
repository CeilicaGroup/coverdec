import { PersonAvatar } from "@/components/person-avatar";
import {
  type ProcessBadgeStyle,
} from "@/components/process-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { getTaskLampElementLabel } from "@/features/planning/task-lamp-frame";
import { taskWorkOrderSummary } from "@/features/work-orders/display";
import {
  getNavePersonnel,
  getPlanningForWeek,
  type ActualHourEntry,
  type NavePersonnel,
} from "@/features/planning/queries";
import { formatActualEntrySummaryLabel } from "@/features/time-tracking/entry-label";
import { absenceCoversCivilIso } from "@/features/people/absence-model";
import { formatDayMonthYear, formatHours, formatTimeRangeFromStartAndHours } from "@/lib/format";
import { WeekDayTasks } from "./week-day-tasks";
import { WeekPersonMobile } from "./week-person-mobile";

export interface WeekPersonListItem {
  id: string;
  nombre: string;
  iniciales: string;
  color: string;
}

export function toWeekPersonListItem(
  person: Pick<NavePersonnel, "id" | "nombre" | "iniciales" | "color">,
): WeekPersonListItem {
  return {
    id: person.id,
    nombre: person.nombre,
    iniciales: person.iniciales,
    color: person.color,
  };
}

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

import type { WorkOrderStatus } from "@/generated/prisma";

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
  workOrderNumber: string | null;
  workOrderStatus: WorkOrderStatus | null;
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
  people: NavePersonnel[],
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
    const wo = taskWorkOrderSummary(a.task);
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
      bastidor: getTaskLampElementLabel(a.task),
      workOrderNumber: wo?.number ?? null,
      workOrderStatus: wo?.status ?? null,
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
  people: NavePersonnel[],
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
      bastidor: e.task ? getTaskLampElementLabel(e.task) : null,
      workOrderNumber: e.task?.workOrder?.number ?? null,
      workOrderStatus: e.task?.workOrder?.status ?? null,
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
  people: NavePersonnel[];
  days: Date[];
  grid: Map<string, Map<string, WeekGridCell[]>>;
  planTask: WeekPersonTaskSummary;
  actualTask: WeekPersonTaskSummary;
  holidayDates: Set<string>;
  absences: { personId: string; date: Date; endDate: Date; reason: string | null }[];
  processStyles: Map<string, ProcessBadgeStyle>;
  canEditEntries: boolean;
  recordsPersonId: string | null;
  entriesByPersonDayTask: ReturnType<typeof buildEntriesByPersonDayTask>;
}

export interface PersonWeekCalendarProps {
  personId: string;
  view: "plan" | "actual";
  days: Date[];
  cells: Map<string, WeekGridCell[]>;
  holidayDates: Set<string>;
  absences: { date: Date; endDate: Date; reason: string | null }[];
  plannedHoursByTask: Map<string, number>;
  plannedDueHoursByTask: Map<string, number>;
  actualHoursByTask: Map<string, number>;
  plannedItemsByTask: Map<string, { id: string; label: string }[]>;
  actualRunningByTask: Map<string, boolean>;
  completedByTask: Map<string, boolean>;
  processStyles: Map<string, ProcessBadgeStyle>;
  canEditEntries: boolean;
  canSeeRecords: boolean;
  entriesByPersonDayTask: ReturnType<typeof buildEntriesByPersonDayTask>;
}

/** Calendario L–V de una sola persona (vista por persona / impresión). */
export function PersonWeekCalendar({
  personId,
  view,
  days,
  cells,
  holidayDates,
  absences,
  plannedHoursByTask,
  plannedDueHoursByTask,
  actualHoursByTask,
  plannedItemsByTask,
  actualRunningByTask,
  completedByTask,
  processStyles,
  canEditEntries,
  canSeeRecords,
  entriesByPersonDayTask,
}: PersonWeekCalendarProps) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <div
          className="grid min-w-[520px] border rounded-md overflow-hidden"
          style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
        >
          {days.map((d, idx) => {
            const key = d.toISOString().slice(0, 10);
            const isHoliday = holidayDates.has(key);
            return (
              <div
                key={key}
                className="bg-muted px-2 py-2 text-xs font-semibold text-center border-b border-r last:border-r-0"
              >
                {DAY_LABELS[idx]}
                <div className="text-[10px] text-muted-foreground font-normal">
                  {formatDayMonthYear(d)}
                </div>
                {isHoliday ? (
                  <div className="text-[10px] text-orange-600 font-bold mt-0.5">Festivo</div>
                ) : null}
              </div>
            );
          })}

          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            const tasks = cells.get(key) ?? [];
            const isAbsent = absences.some((a) => absenceCoversCivilIso(a, key));
            const dayTotal = tasks.reduce((sum, t) => sum + t.hours, 0);
            return (
              <div
                key={`cell-${key}`}
                className="border-b border-r last:border-r-0 px-1.5 py-1.5 min-h-[88px] space-y-1 bg-card flex flex-col"
              >
                <div className="flex-1">
                  <WeekDayTasks
                    personId={personId}
                    dayKey={key}
                    tasks={tasks}
                    view={view}
                    isAbsent={isAbsent}
                    plannedHoursByTask={plannedHoursByTask}
                    plannedDueHoursByTask={plannedDueHoursByTask}
                    actualHoursByTask={actualHoursByTask}
                    plannedItemsByTask={plannedItemsByTask}
                    actualRunningByTask={actualRunningByTask}
                    completedByTask={completedByTask}
                    processStyles={processStyles}
                    canEditEntries={canEditEntries}
                    canSeeRecords={canSeeRecords}
                    entriesByPersonDayTask={entriesByPersonDayTask}
                  />
                </div>
                {dayTotal > 0 ? (
                  <div className="text-center text-[10px] font-semibold text-muted-foreground border-t pt-1">
                    {formatHours(dayTotal)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="md:hidden space-y-3 p-3">
        {days.map((d, idx) => {
          const key = d.toISOString().slice(0, 10);
          const tasks = cells.get(key) ?? [];
          const isHoliday = holidayDates.has(key);
          const isAbsent = absences.some((a) => absenceCoversCivilIso(a, key));
          const dayTotal = tasks.reduce((sum, t) => sum + t.hours, 0);
          return (
            <div key={key} className="rounded-lg border bg-card/50 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <div>
                  <div className="text-xs font-semibold">{DAY_LABELS[idx]}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatDayMonthYear(d)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isHoliday ? (
                    <span className="text-[10px] font-bold text-orange-600">Festivo</span>
                  ) : null}
                  {dayTotal > 0 ? (
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {formatHours(dayTotal)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="p-3">
                <WeekDayTasks
                  personId={personId}
                  dayKey={key}
                  tasks={tasks}
                  view={view}
                  isAbsent={isAbsent}
                  plannedHoursByTask={plannedHoursByTask}
                  plannedDueHoursByTask={plannedDueHoursByTask}
                  actualHoursByTask={actualHoursByTask}
                  plannedItemsByTask={plannedItemsByTask}
                  actualRunningByTask={actualRunningByTask}
                  completedByTask={completedByTask}
                  processStyles={processStyles}
                  canEditEntries={canEditEntries}
                  canSeeRecords={canSeeRecords}
                  entriesByPersonDayTask={entriesByPersonDayTask}
                  emptyClassName="text-xs"
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
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
  recordsPersonId,
  entriesByPersonDayTask,
}: WeekPersonGridProps) {
  const gridContent = (
    <>
      <div className="hidden md:block">
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
              canSeeRecords={recordsPersonId == null || recordsPersonId === person.id}
              entriesByPersonDayTask={entriesByPersonDayTask}
            />
          ))}
        </div>
      </div>
      <div className="md:hidden">
        <WeekPersonMobile
          view={view}
          people={people.map(toWeekPersonListItem)}
          days={days}
          grid={grid}
          planTask={planTask}
          actualTask={actualTask}
          holidayDates={holidayDates}
          absences={absences.map((a) => ({
            personId: a.personId,
            date: a.date,
            endDate: a.endDate,
            reason: a.reason,
          }))}
          processStyles={processStyles}
          canEditEntries={canEditEntries}
          recordsPersonId={recordsPersonId}
          entriesByPersonDayTask={entriesByPersonDayTask}
        />
      </div>
    </>
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
  canSeeRecords,
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
  absences: { date: Date; endDate: Date; reason: string | null }[];
  processStyles: Map<string, ProcessBadgeStyle>;
  canEditEntries: boolean;
  canSeeRecords: boolean;
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
        const isAbsent = absences.some((a) => absenceCoversCivilIso(a, key));
        return (
          <div
            key={key}
            className="border-b border-r last:border-r-0 px-1.5 py-1.5 min-h-[80px] space-y-1 bg-card"
          >
            <WeekDayTasks
              personId={person.id}
              dayKey={key}
              tasks={tasks}
              view={view}
              isAbsent={isAbsent}
              plannedHoursByTask={plannedHoursByTask}
              plannedDueHoursByTask={plannedDueHoursByTask}
              actualHoursByTask={actualHoursByTask}
              plannedItemsByTask={plannedItemsByTask}
              actualRunningByTask={actualRunningByTask}
              completedByTask={completedByTask}
              processStyles={processStyles}
              canEditEntries={canEditEntries}
              canSeeRecords={canSeeRecords}
              entriesByPersonDayTask={entriesByPersonDayTask}
            />
          </div>
        );
      })}
    </>
  );
}
