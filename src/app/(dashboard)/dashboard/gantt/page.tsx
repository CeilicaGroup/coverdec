import { requireDashboardContext } from "@/lib/context";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import {
  getActiveProjectsForGantt,
  getGanttPlanningAssignments,
  getHolidaysForRange,
  getNavePersonnel,
  getProcessBadgeStylesByCode,
  getProcessDefinitionsByCode,
  type GanttPlanningAssignment,
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
  computeGanttAxisRange,
  filterGanttAssignments,
} from "@/features/planning/gantt-data";
import type { GanttTimelineBlock } from "@/features/planning/gantt-data";
import { PageHeader } from "../../_components/page-header";
import { GanttChart } from "./gantt-chart";
import { GanttFilters, type GanttAxisMode } from "./gantt-filters";
import { GanttWorkerChart, type GanttWorkerRow } from "./gantt-worker-chart";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function parseSelectedIds(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  if (raw.trim() === "__none__") return ["__none__"];
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function buildAxisRangeFromAssignments(assignments: GanttPlanningAssignment[], todayIso: string) {
  if (assignments.length === 0) {
    const start = new Date(`${todayIso}T00:00:00.000Z`);
    const end = addDays(start, 20);
    return {
      axisStartIso: todayIso,
      axisEndIso: end.toISOString().slice(0, 10),
    };
  }

  const sorted = [...assignments].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
  );
  const first = sorted[0]!.date;
  const last = sorted[sorted.length - 1]!.date;
  return {
    axisStartIso: addDays(first, -1).toISOString().slice(0, 10),
    axisEndIso: addDays(last, 1).toISOString().slice(0, 10),
  };
}

function buildWorkerRows(assignments: GanttPlanningAssignment[]): GanttWorkerRow[] {
  const byWorker = new Map<string, GanttPlanningAssignment[]>();
  for (const assignment of assignments) {
    const list = byWorker.get(assignment.personId) ?? [];
    list.push(assignment);
    byWorker.set(assignment.personId, list);
  }

  return [...byWorker.entries()]
    .map(([workerId, workerAssignments]) => {
      const sorted = [...workerAssignments].sort(
        (a, b) => a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
      );
      const person = sorted[0]!.person;

      const timelineBlocks: GanttTimelineBlock[] = sorted.map((a) => ({
        kind: "work" as const,
        startDayIso: a.date.toISOString().slice(0, 10),
        endDayIso: a.date.toISOString().slice(0, 10),
        startSlot: a.startSlot,
        endSlot: a.endSlot,
        hours: a.hours,
        label: `${a.task.project.name} · ${a.task.lamp.name ?? "Lámpara"} · ${a.process} · ${rangeLabel(a.startSlot, a.endSlot)} · ${a.hours}h`,
      }));

      const byTask = new Map<string, GanttPlanningAssignment[]>();
      for (const assignment of sorted) {
        const list = byTask.get(assignment.taskId) ?? [];
        list.push(assignment);
        byTask.set(assignment.taskId, list);
      }

      const tasks = [...byTask.entries()].map(([taskId, taskAssignments]) => {
        const taskSorted = [...taskAssignments].sort(
          (a, b) => a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
        );
        const first = taskSorted[0]!;
        const last = taskSorted[taskSorted.length - 1]!;
        return {
          id: `${workerId}:${taskId}`,
          label: `${first.task.project.name} · ${first.task.lamp.name ?? "Lámpara"}`,
          process: first.process,
          estimatedStart: first.date.toISOString().slice(0, 10),
          estimatedEnd: last.date.toISOString().slice(0, 10),
          isAssigned: true,
          timelineBlocks: taskSorted.map((a) => ({
            kind: "work" as const,
            startDayIso: a.date.toISOString().slice(0, 10),
            endDayIso: a.date.toISOString().slice(0, 10),
            startSlot: a.startSlot,
            endSlot: a.endSlot,
            hours: a.hours,
            label: `${a.task.project.name} · ${a.task.lamp.name ?? "Lámpara"} · ${a.process} · ${rangeLabel(a.startSlot, a.endSlot)} · ${a.hours}h`,
          })),
        };
      });

      return {
        id: workerId,
        iniciales: person.iniciales,
        nombre: person.nombre,
        color: person.color,
        estimatedStart: sorted[0]!.date.toISOString().slice(0, 10),
        estimatedEnd: sorted[sorted.length - 1]!.date.toISOString().slice(0, 10),
        isAssigned: sorted.length > 0,
        timelineBlocks,
        tasks,
      };
    })
    .sort((a, b) => a.iniciales.localeCompare(b.iniciales, "es"));
}

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<{
    axis?: string;
    projects?: string;
    people?: string;
  }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const axisMode: GanttAxisMode = params.axis === "worker" ? "worker" : "project";
  const projectIds = parseSelectedIds(params.projects);
  const personIds = parseSelectedIds(params.people);

  const [projects, assignments, people, processStyles, processDefs] = await Promise.all([
    getActiveProjectsForGantt(ctx.naveId),
    ctx.naveId ? getGanttPlanningAssignments(ctx.naveId) : Promise.resolve([]),
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

  const provisionalHolidayDates = expandHolidayRangesToIsoDays([], today, addDays(today, 365));

  const priorChainContext = {
    tasks: allGanttTasks,
    priorEnds,
    waitHoursByProcess,
    holidayDates: provisionalHolidayDates,
  };
  const priorChainStartByTaskId = buildPriorChainStartIsoByTaskId(priorChainContext);
  const nextChainAfterPriorTaskByTaskId = buildNextChainAfterPriorTaskByTaskId(priorChainContext);

  let ganttProjects = buildGanttProjects({
    projects,
    assignments,
    projectIds,
    anchorDateIso: todayIso,
    holidayDates: provisionalHolidayDates,
    waitHoursByProcess,
    priorChainStartByTaskId,
    nextChainAfterPriorTaskByTaskId,
  });

  const baseAssignments = filterGanttAssignments(assignments, {
    projectIds,
    personIds: axisMode === "worker" ? personIds : undefined,
  });

  const axisRange =
    axisMode === "worker"
      ? buildAxisRangeFromAssignments(baseAssignments, todayIso)
      : computeGanttAxisRange(ganttProjects, todayIso, provisionalHolidayDates);

  const axisStart = new Date(`${axisRange.axisStartIso}T00:00:00.000Z`);
  const axisEnd = new Date(`${axisRange.axisEndIso}T00:00:00.000Z`);
  const holidays = await getHolidaysForRange(axisStart, axisEnd);
  const holidayDates = expandHolidayRangesToIsoDays(holidays, axisStart, axisEnd);

  ganttProjects = buildGanttProjects({
    projects,
    assignments,
    projectIds,
    anchorDateIso: todayIso,
    holidayDates,
    waitHoursByProcess,
    priorChainStartByTaskId,
    nextChainAfterPriorTaskByTaskId,
  });

  const filteredAssignments = filterGanttAssignments(assignments, {
    projectIds,
    personIds: axisMode === "worker" ? personIds : undefined,
  });

  const milestones = buildGanttMilestones(
    filteredAssignments,
    axisRange.axisStartIso,
    axisRange.axisEndIso,
  );

  const projectOptions = buildGanttProjectOptions(projects);
  const processStylesRecord = Object.fromEntries(processStyles);
  const workerRows = axisMode === "worker" ? buildWorkerRows(filteredAssignments) : [];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Vista Gantt"
        description="Planificación de proyectos activos"
        actions={
          <GanttFilters
            axisMode={axisMode}
            people={people.map((p) => ({
              id: p.id,
              iniciales: p.iniciales,
              nombre: p.nombre,
            }))}
            projectOptions={projectOptions}
            selectedProjectIds={projectIds ?? []}
            selectedPersonIds={personIds ?? []}
          />
        }
      />

      {axisMode === "worker" ? (
        <GanttWorkerChart
          axisStartIso={axisRange.axisStartIso}
          axisEndIso={axisRange.axisEndIso}
          workers={workerRows}
          processStyles={processStylesRecord}
        />
      ) : (
        <GanttChart
          axisStartIso={axisRange.axisStartIso}
          axisEndIso={axisRange.axisEndIso}
          todayIso={todayIso}
          projects={ganttProjects}
          milestones={milestones}
          processStyles={processStylesRecord}
        />
      )}
    </div>
  );
}
