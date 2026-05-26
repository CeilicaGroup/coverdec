import { requireDashboardContext } from "@/lib/context";
import { formatDayMonthYear } from "@/lib/format";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import {
  getActiveProjectsForGantt,
  getHolidaysForRange,
  getNavePersonnel,
  getPlanningForWeek,
  getProcessBadgeStylesByCode,
  getProcessDefinitionsByCode,
} from "@/features/planning/queries";
import {
  buildLastAssignmentEndByTaskId,
  buildNextChainAfterPriorTaskByTaskId,
  buildPriorChainStartIsoByTaskId,
  buildPriorPlannedHoursByTaskId,
  getPriorPlanningAssignmentsDetailed,
} from "@/features/planning/prior-week-planning";
import {
  buildGanttProjects,
  buildGanttTaskOptions,
  filterPlanningAssignments,
  findGanttExpandTargets,
  toPlanningDayIso,
} from "@/features/planning/gantt-data";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { GanttChart, type GanttMilestone } from "./gantt-chart";
import { GanttFilters } from "./gantt-filters";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; person?: string; task?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const monday = getMondayOf(weekStart);

  const personId = params.person || undefined;
  const taskId = params.task || undefined;

  const [projects, planning, people, processStyles, holidays, priorAssignments, processDefs] =
    await Promise.all([
      getActiveProjectsForGantt(ctx.naveId),
      getPlanningForWeek({ naveId: ctx.naveId, weekStart }),
      getNavePersonnel(ctx.naveId),
      getProcessBadgeStylesByCode(),
      getHolidaysForRange(monday, addDays(monday, 56)),
      ctx.naveId
        ? getPriorPlanningAssignmentsDetailed({
            naveId: ctx.naveId,
            beforeWeekStart: weekStart,
          })
        : Promise.resolve([]),
      getProcessDefinitionsByCode(),
    ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    monday,
    addDays(monday, 56),
  );

  const allGanttTasks = projects.flatMap((p) => p.tasks);
  const priorPlannedHoursByTask = buildPriorPlannedHoursByTaskId(priorAssignments);
  const priorEnds = buildLastAssignmentEndByTaskId(priorAssignments);
  const waitHoursByProcess = new Map(
    [...processDefs.entries()].map(([code, d]) => [code, d.waitHours]),
  );
  const priorChainContext = {
    tasks: allGanttTasks,
    priorEnds,
    waitHoursByProcess,
    holidayDates,
  };
  const priorChainStartByTaskId = buildPriorChainStartIsoByTaskId(priorChainContext);
  const nextChainAfterPriorTaskByTaskId =
    buildNextChainAfterPriorTaskByTaskId(priorChainContext);

  const ganttProjects = buildGanttProjects({
    projects,
    planning,
    personId,
    taskId,
    anchorDateIso: todayIso,
    holidayDates,
    priorChainStartByTaskId,
    nextChainAfterPriorTaskByTaskId,
    priorAssignmentsDetailed: priorAssignments,
    priorPlannedHoursByTask,
  });

  const assignedThisWeekByTask = new Map<string, number>();
  if (planning) {
    for (const a of planning.assignments) {
      assignedThisWeekByTask.set(
        a.taskId,
        (assignedThisWeekByTask.get(a.taskId) ?? 0) + a.hours,
      );
    }
  }

  const taskOptions = buildGanttTaskOptions(projects, assignedThisWeekByTask);

  const filteredAssignments = filterPlanningAssignments(planning, {
    personId,
    taskId,
  });

  let horizonEnd = addDays(monday, 56);
  for (const p of ganttProjects) {
    for (const iso of [p.estimatedEnd, p.deliveryDate, p.expectedCompletion]) {
      if (!iso) continue;
      const end = new Date(`${iso}T00:00:00.000Z`);
      if (end.getTime() > horizonEnd.getTime()) horizonEnd = end;
    }
    for (const l of p.lamps) {
      const end = new Date(`${l.estimatedEnd}T00:00:00.000Z`);
      if (end.getTime() > horizonEnd.getTime()) horizonEnd = end;
    }
  }

  const milestones: GanttMilestone[] = days.map((day, idx) => {
    const key = toPlanningDayIso(day);
    const lines: string[] = [];
    for (const a of filteredAssignments) {
      if (toPlanningDayIso(a.date) !== key) continue;
      lines.push(
        `${a.task.project.name} · ${a.process} · ${a.hours}h (${a.person.iniciales})`,
      );
    }
    return {
      dateKey: key,
      dayLabel: `${DAY_LABELS[idx]} ${formatDayMonthYear(day)}`,
      lines,
    };
  });

  const processStylesRecord = Object.fromEntries(processStyles);
  const expandTargets = findGanttExpandTargets(ganttProjects, taskId);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista Gantt · S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GanttFilters
              people={people.map((p) => ({
                id: p.id,
                iniciales: p.iniciales,
                nombre: p.nombre,
              }))}
              taskOptions={taskOptions}
              selectedPersonId={personId}
              selectedTaskId={taskId}
            />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
            />
          </div>
        }
      />
      <GanttChart
        weekStartIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
        horizonEndIso={horizonEnd.toISOString().slice(0, 10)}
        todayIso={todayIso}
        projects={ganttProjects}
        milestones={milestones}
        autoExpandProjectId={expandTargets.projectId}
        autoExpandLampId={expandTargets.lampId}
        processStyles={processStylesRecord}
      />
    </div>
  );
}
