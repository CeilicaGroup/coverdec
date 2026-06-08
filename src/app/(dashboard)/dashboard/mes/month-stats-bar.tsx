import { CalendarCheck2, Clock3, FolderKanban, Users } from "lucide-react";
import { formatHours } from "@/lib/format";
import type { MonthPlanningStats } from "@/features/planning/queries";

export function MonthStatsBar({
  stats,
  view,
}: {
  stats: MonthPlanningStats;
  view: "plan" | "actual";
}) {
  const label = view === "actual" ? "registradas" : "planificadas";
  const coverage =
    stats.businessDays > 0
      ? Math.round((stats.plannedDays / stats.businessDays) * 100)
      : 0;

  const items = [
    {
      icon: Clock3,
      label: `Horas ${label}`,
      value: formatHours(stats.totalHours),
    },
    {
      icon: CalendarCheck2,
      label: "Días con carga",
      value: `${stats.plannedDays}/${stats.businessDays} (${coverage}%)`,
    },
    {
      icon: Users,
      label: "Operarios",
      value: String(stats.peopleCount),
    },
    {
      icon: FolderKanban,
      label: "Proyectos",
      value: String(stats.projectCount),
    },
  ];

  if (view === "plan") {
    items.push({
      icon: CalendarCheck2,
      label: "Semanas con planning",
      value: `${stats.weeksWithPlanning}/${stats.calendarWeeks}`,
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3"
        >
          <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="truncate text-sm font-semibold tabular-nums">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
