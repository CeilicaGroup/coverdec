import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PersonAvatar } from "@/components/person-avatar";
import { Card, CardContent } from "@/components/ui/card";
import type { DayPlanningSummary } from "@/features/planning/queries";
import { formatCivilIsoDate } from "@/lib/civil-date";
import { formatHours } from "@/lib/format";
import { getMondayOf } from "@/lib/week";
import { cn } from "@/lib/utils";

interface MonthMobileListProps {
  weeks: Array<Array<{ iso: string; dayOfMonth: number } | null>>;
  summariesByDay: Map<string, DayPlanningSummary>;
  holidayDates: Set<string>;
  view: "plan" | "actual";
  todayIso: string;
}

function weekdayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  return date.toLocaleDateString("es-ES", { weekday: "long" });
}

function weekHref(iso: string, view: "plan" | "actual"): string {
  const weekMonday = getMondayOf(new Date(`${iso}T00:00:00.000Z`)).toISOString().slice(0, 10);
  return `/dashboard/semana?week=${weekMonday}${view === "actual" ? "&view=actual" : ""}`;
}

export function MonthMobileList({
  weeks,
  summariesByDay,
  holidayDates,
  view,
  todayIso,
}: MonthMobileListProps) {
  const days = weeks
    .flatMap((week) => week.filter((cell): cell is { iso: string; dayOfMonth: number } => cell != null))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  return (
    <div className="space-y-2 p-3">
      {days.map((day) => {
        const summary = summariesByDay.get(day.iso);
        const isHoliday = holidayDates.has(day.iso);
        const isToday = day.iso === todayIso;
        const hasWork = summary && summary.totalHours > 0;
        const href = weekHref(day.iso, view);

        return (
          <Card key={day.iso} className={cn(isToday && "ring-2 ring-primary/40")}>
            <CardContent className="p-0">
              <Link
                href={href}
                className="flex items-start gap-3 p-3 transition-colors hover:bg-accent/40"
              >
                <div
                  className={cn(
                    "flex size-10 shrink-0 flex-col items-center justify-center rounded-lg border text-center",
                    isToday && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  <span className="text-[10px] uppercase leading-none opacity-80">
                    {weekdayLabel(day.iso).slice(0, 3)}
                  </span>
                  <span className="text-sm font-bold tabular-nums leading-tight">
                    {day.dayOfMonth}
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium capitalize truncate">
                      {formatCivilIsoDate(day.iso)}
                    </span>
                    {isHoliday ? (
                      <span className="shrink-0 text-[10px] font-semibold text-orange-600">
                        Festivo
                      </span>
                    ) : hasWork ? (
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatHours(summary.totalHours)}
                      </span>
                    ) : null}
                  </div>

                  {isHoliday ? (
                    <p className="text-xs text-muted-foreground">Sin carga planificable</p>
                  ) : hasWork && summary ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {summary.assignmentCount} asignación
                        {summary.assignmentCount === 1 ? "" : "es"}
                        {summary.projectCount > 0
                          ? ` · ${summary.projectCount} proyecto${summary.projectCount === 1 ? "" : "s"}`
                          : ""}
                      </p>
                      {summary.people.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {summary.people.slice(0, 6).map((p) => (
                            <PersonAvatar
                              key={p.id}
                              iniciales={p.iniciales}
                              color={p.color}
                              size={20}
                            />
                          ))}
                          {summary.people.length > 6 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{summary.people.length - 6}
                            </span>
                          )}
                        </div>
                      )}
                      {summary.topProjects.length > 0 && (
                        <ul className="text-[11px] text-muted-foreground space-y-0.5">
                          {summary.topProjects.slice(0, 2).map((project) => (
                            <li key={project.id} className="truncate">
                              {project.name}{" "}
                              <span className="tabular-nums">({formatHours(project.hours)})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {view === "actual" ? "Sin registros" : "Sin planning"}
                    </p>
                  )}
                </div>

                <ChevronRight className="size-4 shrink-0 text-muted-foreground mt-2" />
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
