import { requireDashboardContext } from "@/lib/context";
import { formatDayMonthYear } from "@/lib/format";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import {
  getActiveProjectsWithLoad,
  getPlanningForWeek,
  summarizeAllActiveProjects,
} from "@/features/planning/queries";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { GanttChart, type GanttMilestone } from "./gantt-chart";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [projects, planning] = await Promise.all([
    getActiveProjectsWithLoad(ctx.empresaId),
    getPlanningForWeek({ empresaId: ctx.empresaId, weekStart }),
  ]);

  const portfolio = summarizeAllActiveProjects(projects, planning);

  const ganttProjects = portfolio
    .filter((p) => p.remainingWorkHours > 0)
    .map((p) => ({
      id: p.projectId,
      name: p.name,
      deliveryDate: p.deliveryDate?.toISOString().slice(0, 10) ?? null,
      expectedCompletion: p.expectedCompletion?.toISOString().slice(0, 10) ?? null,
      remainingWorkHours: p.remainingWorkHours,
      risk: p.risk,
    }));

  let horizonEnd = addDays(getMondayOf(weekStart), 56);
  for (const p of ganttProjects) {
    const endIso = p.deliveryDate ?? p.expectedCompletion;
    if (endIso) {
      const end = new Date(`${endIso}T00:00:00.000Z`);
      if (end.getTime() > horizonEnd.getTime()) horizonEnd = end;
    }
  }

  const milestones: GanttMilestone[] = days.map((day, idx) => {
    const key = day.toISOString().slice(0, 10);
    const lines: string[] = [];
    if (planning) {
      for (const a of planning.assignments) {
        if (a.date.toISOString().slice(0, 10) !== key) continue;
        lines.push(
          `${a.task.project.name} · ${a.process} · ${a.hours}h (${a.person.iniciales})`,
        );
      }
    }
    return {
      dateKey: key,
      dayLabel: `${DAY_LABELS[idx]} ${formatDayMonthYear(day)}`,
      lines,
    };
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista Gantt · S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <WeekNav
            weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
            weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
          />
        }
      />
      <GanttChart
        weekStartIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
        horizonEndIso={horizonEnd.toISOString().slice(0, 10)}
        todayIso={today.toISOString().slice(0, 10)}
        projects={ganttProjects}
        milestones={milestones}
      />
    </div>
  );
}
