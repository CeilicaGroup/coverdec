import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type {
  DayPlanningSummary,
  WeekRowSummary,
} from "@/features/planning/queries";
import { formatHours } from "@/lib/format";
import { getMondayOf } from "@/lib/week";
import { MonthDayCell } from "./month-day-cell";
import { MonthMobileList } from "./month-mobile-list";

const DAY_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie"];

interface MonthCalendarGridProps {
  weeks: Array<Array<{ iso: string; dayOfMonth: number } | null>>;
  summariesByDay: Map<string, DayPlanningSummary>;
  weekRows: Map<string, WeekRowSummary>;
  holidayDates: Set<string>;
  view: "plan" | "actual";
  todayIso: string;
  maxDayHours: number;
}

export function MonthCalendarGrid({
  weeks,
  summariesByDay,
  weekRows,
  holidayDates,
  view,
  todayIso,
  maxDayHours,
}: MonthCalendarGridProps) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-[108px] border-b bg-muted/40 px-2 py-2 text-left text-xs font-semibold text-muted-foreground">
                Semana
              </th>
              {DAY_HEADERS.map((label) => (
                <th
                  key={label}
                  className="border-b bg-muted/40 px-2 py-2 text-left text-xs font-semibold text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => {
              const firstDay = week.find((cell) => cell != null);
              const weekMonday = firstDay
                ? getMondayOf(new Date(`${firstDay.iso}T00:00:00.000Z`))
                    .toISOString()
                    .slice(0, 10)
                : null;
              const weekRow = weekMonday ? weekRows.get(weekMonday) : undefined;

              return (
                <tr key={`week-${wi}`}>
                  <td className="border-b border-r align-top bg-muted/15 p-2">
                    {weekRow ? (
                      <WeekSidebar weekRow={weekRow} view={view} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  {week.map((cell, ci) => (
                    <td
                      key={`${wi}-${ci}`}
                      className="border-b border-r align-top p-0 last:border-r-0"
                    >
                      {cell ? (
                        <MonthDayCell
                          iso={cell.iso}
                          dayOfMonth={cell.dayOfMonth}
                          summary={summariesByDay.get(cell.iso)}
                          isHoliday={holidayDates.has(cell.iso)}
                          isToday={cell.iso === todayIso}
                          view={view}
                          maxDayHours={maxDayHours}
                          href={`/dashboard/semana?week=${getMondayOf(new Date(`${cell.iso}T00:00:00.000Z`)).toISOString().slice(0, 10)}${view === "actual" ? "&view=actual" : ""}`}
                        />
                      ) : (
                        <div className="min-h-[112px] bg-muted/20" />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        <MonthMobileList
          weeks={weeks}
          summariesByDay={summariesByDay}
          holidayDates={holidayDates}
          view={view}
          todayIso={todayIso}
        />
      </div>
    </>
  );
}

function WeekSidebar({
  weekRow,
  view,
}: {
  weekRow: WeekRowSummary;
  view: "plan" | "actual";
}) {
  const href = `/dashboard/semana?week=${weekRow.weekMondayIso}${
    view === "actual" ? "&view=actual" : ""
  }`;

  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md p-1 transition-colors hover:bg-accent/60"
    >
      <span className="text-xs font-semibold tabular-nums">
        S{String(weekRow.weekNumber).padStart(2, "0")}
      </span>
      <span className="text-[11px] font-medium tabular-nums">
        {weekRow.totalHours > 0 ? formatHours(weekRow.totalHours) : "—"}
      </span>
      {view === "plan" && weekRow.status && (
        <Badge
          variant={weekRow.status === "PUBLISHED" ? "default" : "secondary"}
          className="w-fit px-1.5 py-0 text-[10px]"
        >
          {weekRow.status === "PUBLISHED" ? "Publicado" : "Borrador"}
        </Badge>
      )}
    </Link>
  );
}
