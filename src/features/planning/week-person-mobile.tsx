"use client";

import { PersonAvatar } from "@/components/person-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProcessBadgeStyle } from "@/components/process-badge";
import { absenceCoversCivilIso } from "@/features/people/absence-model";
import { formatDayMonthYear } from "@/lib/format";
import type { getNavePersonnel } from "@/features/planning/queries";
import { WeekDayTasks } from "./week-day-tasks";
import type {
  WeekGridCell,
  WeekPersonTaskSummary,
  buildEntriesByPersonDayTask,
} from "./week-person-grid";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

interface WeekPersonMobileProps {
  view: "plan" | "actual";
  people: Awaited<ReturnType<typeof getNavePersonnel>>;
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

export function WeekPersonMobile({
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
}: WeekPersonMobileProps) {
  const visiblePeople = recordsPersonId
    ? people.filter((p) => p.id === recordsPersonId)
    : people;

  const taskSummary = view === "actual" ? actualTask : planTask;

  return (
    <div className="space-y-4 p-3">
      {visiblePeople.map((person) => {
        const cells = grid.get(person.id) ?? new Map<string, WeekGridCell[]>();
        const personAbsences = absences.filter((a) => a.personId === person.id);
        const plannedHoursByTask = taskSummary.hoursByPersonTask.get(person.id) ?? new Map();
        const plannedDueHoursByTask = taskSummary.dueHoursByPersonTask.get(person.id) ?? new Map();
        const actualHoursByTask =
          view === "actual"
            ? (actualTask.hoursByPersonTask.get(person.id) ?? new Map())
            : plannedHoursByTask;
        const plannedItemsByTask = taskSummary.itemsByPersonTask.get(person.id) ?? new Map();
        const actualRunningByTask = actualTask.runningByPersonTask.get(person.id) ?? new Map();
        const completedByTask = actualTask.completedByPersonTask.get(person.id) ?? new Map();
        const canSeeRecords = recordsPersonId == null || recordsPersonId === person.id;

        return (
          <Card key={person.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PersonAvatar iniciales={person.iniciales} color={person.color} size={28} />
                <span className="truncate">{person.nombre}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {days.map((d, idx) => {
                const key = d.toISOString().slice(0, 10);
                const tasks = cells.get(key) ?? [];
                const isHoliday = holidayDates.has(key);
                const isAbsent = personAbsences.some((a) => absenceCoversCivilIso(a, key));

                return (
                  <div key={key} className="rounded-lg border bg-card/50 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                      <div>
                        <div className="text-xs font-semibold">{DAY_LABELS[idx]}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDayMonthYear(d)}
                        </div>
                      </div>
                      {isHoliday ? (
                        <span className="text-[10px] font-bold text-orange-600">Festivo</span>
                      ) : null}
                    </div>
                    <div className="p-3">
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
                        emptyClassName="text-xs"
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
