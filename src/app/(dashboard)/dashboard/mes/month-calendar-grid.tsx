import Link from "next/link";
import { PersonAvatar } from "@/components/person-avatar";
import type { DayPlanningSummary } from "@/features/planning/queries";
import { formatHours } from "@/lib/format";
import { getMondayOf } from "@/lib/week";
import { cn } from "@/lib/utils";

const DAY_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie"];

interface MonthCalendarGridProps {
  weeks: Array<Array<{ iso: string; dayOfMonth: number } | null>>;
  summariesByDay: Map<string, DayPlanningSummary>;
  holidayDates: Set<string>;
  view: "plan" | "actual";
}

export function MonthCalendarGrid({
  weeks,
  summariesByDay,
  holidayDates,
  view,
}: MonthCalendarGridProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
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
          {weeks.map((week, wi) => (
            <tr key={`week-${wi}`}>
              {week.map((cell, ci) => (
                <td
                  key={`${wi}-${ci}`}
                  className="border-b border-r align-top p-0 last:border-r-0"
                >
                  {cell ? (
                    <DayCell
                      iso={cell.iso}
                      dayOfMonth={cell.dayOfMonth}
                      summary={summariesByDay.get(cell.iso)}
                      isHoliday={holidayDates.has(cell.iso)}
                      view={view}
                    />
                  ) : (
                    <div className="min-h-[88px] bg-muted/20" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayCell({
  iso,
  dayOfMonth,
  summary,
  isHoliday,
  view,
}: {
  iso: string;
  dayOfMonth: number;
  summary?: DayPlanningSummary;
  isHoliday: boolean;
  view: "plan" | "actual";
}) {
  const weekMonday = getMondayOf(new Date(`${iso}T00:00:00.000Z`))
    .toISOString()
    .slice(0, 10);
  const href = `/dashboard/semana?week=${weekMonday}${view === "actual" ? "&view=actual" : ""}`;
  const hasPlan = summary && summary.totalHours > 0;

  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-[88px] flex-col gap-1 p-2 transition-colors hover:bg-accent/50",
        isHoliday && "bg-muted/30",
        !hasPlan && !isHoliday && "text-muted-foreground",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold tabular-nums">{dayOfMonth}</span>
        {isHoliday && (
          <span className="text-[10px] font-medium text-muted-foreground">Festivo</span>
        )}
      </div>
      {hasPlan ? (
        <>
          <span className="text-xs font-medium">{formatHours(summary.totalHours)}</span>
          <div className="flex flex-wrap gap-0.5">
            {summary.people.slice(0, 3).map((p) => (
              <PersonAvatar
                key={p.id}
                iniciales={p.iniciales}
                color={p.color}
                size={20}
              />
            ))}
            {summary.people.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{summary.people.length - 3}
              </span>
            )}
          </div>
          {summary.projectCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {summary.projectCount} proyecto{summary.projectCount === 1 ? "" : "s"}
            </span>
          )}
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">Sin planning</span>
      )}
    </Link>
  );
}
