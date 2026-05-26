import { requireDashboardContext } from "@/lib/context";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import {
  getActiveProjectsForGantt,
  getGanttPlanningAssignments,
  getHolidaysForRange,
  getNavePersonnel,
  getProcessBadgeStylesByCode,
  getProcessDefinitionsByCode,
} from "@/features/planning/queries";
import {
  buildLastAssignmentEndByTaskId,
  buildNextChainAfterPriorTaskByTaskId,
  buildPriorChainStartIsoByTaskId,
} from "@/features/planning/prior-week-planning";
import {
  buildGanttMilestones,
  buildGanttProjectOptions,
  buildGanttProjects,
  buildGanttTaskOptions,
  computeGanttAxisRange,
  filterGanttAssignments,
  findGanttExpandTargets,
} from "@/features/planning/gantt-data";
import { PageHeader } from "../../_components/page-header";
import { GanttChart } from "./gantt-chart";
import { GanttFilters } from "./gantt-filters";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function parseProjectIds(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  if (raw.trim() === "__none__") return ["__none__"];
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<{
    person?: string;
    task?: string;
    projects?: string;
  }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const personId = params.person || undefined;
  const taskId = params.task || undefined;
  const projectIds = parseProjectIds(params.projects);

  const [projects, assignments, people, processStyles, processDefs] =
    await Promise.all([
      getActiveProjectsForGantt(ctx.naveId),
      ctx.naveId
        ? getGanttPlanningAssignments(ctx.naveId)
        : Promise.resolve([]),
      getNavePersonnel(ctx.naveId),
      getProcessBadgeStylesByCode(),
      getProcessDefinitionsByCode(),
    ]);

  const allGanttTasks = projects.flatMap((p) => p.tasks);
  const priorEnds = buildLastAssignmentEndByTaskId(
    assignments.map((a) => ({
      taskId: a.taskId,
      date: a.date,
      endSlot: a.endSlot,
      hours: a.hours,
    })),
  );
  const waitHoursByProcess = new Map(
    [...processDefs.entries()].map(([code, d]) => [code, d.waitHours]),
  );

  const provisionalHolidayDates = expandHolidayRangesToIsoDays(
    [],
    today,
    addDays(today, 365),
  );

  const priorChainContext = {
    tasks: allGanttTasks,
    priorEnds,
    waitHoursByProcess,
    holidayDates: provisionalHolidayDates,
  };
  const priorChainStartByTaskId =
    buildPriorChainStartIsoByTaskId(priorChainContext);
  const nextChainAfterPriorTaskByTaskId =
    buildNextChainAfterPriorTaskByTaskId(priorChainContext);

  let ganttProjects = buildGanttProjects({
    projects,
    assignments,
    personId,
    taskId,
    projectIds,
    anchorDateIso: todayIso,
    holidayDates: provisionalHolidayDates,
    waitHoursByProcess,
    priorChainStartByTaskId,
    nextChainAfterPriorTaskByTaskId,
  });

  const { axisStartIso, axisEndIso } = computeGanttAxisRange(
    ganttProjects,
    todayIso,
    provisionalHolidayDates,
  );

  const axisStart = new Date(`${axisStartIso}T00:00:00.000Z`);
  const axisEnd = new Date(`${axisEndIso}T00:00:00.000Z`);
  const holidays = await getHolidaysForRange(axisStart, axisEnd);
  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    axisStart,
    axisEnd,
  );

  ganttProjects = buildGanttProjects({
    projects,
    assignments,
    personId,
    taskId,
    projectIds,
    anchorDateIso: todayIso,
    holidayDates,
    waitHoursByProcess,
    priorChainStartByTaskId,
    nextChainAfterPriorTaskByTaskId,
  });

  const filteredAssignments = filterGanttAssignments(assignments, {
    personId,
    taskId,
    projectIds,
  });

  const milestones = buildGanttMilestones(
    filteredAssignments,
    axisStartIso,
    axisEndIso,
  );

  const projectOptions = buildGanttProjectOptions(projects);
  const taskOptions = buildGanttTaskOptions(projects);
  const processStylesRecord = Object.fromEntries(processStyles);
  const expandTargets = findGanttExpandTargets(ganttProjects, taskId);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Vista Gantt"
        description="Planificación de proyectos activos"
        actions={
          <GanttFilters
            people={people.map((p) => ({
              id: p.id,
              iniciales: p.iniciales,
              nombre: p.nombre,
            }))}
            projectOptions={projectOptions}
            taskOptions={taskOptions}
            selectedPersonId={personId}
            selectedTaskId={taskId}
            selectedProjectIds={projectIds ?? []}
          />
        }
      />
      <GanttChart
        axisStartIso={axisStartIso}
        axisEndIso={axisEndIso}
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
