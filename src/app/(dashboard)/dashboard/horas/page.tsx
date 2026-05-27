import { PlanningStatus } from "@/generated/prisma";
import { naveScopeFromContext } from "@/lib/nave-filter";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntriesList } from "./entries-list";
import { getProcessBadgeStylesByCode } from "@/features/planning/queries";
import { TaskQueuePanel } from "./task-queue-panel";
import { rangeLabel } from "@/features/planning/engine/slot-format";

function weekdayLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(".", "");
}

export default async function HorasPage() {
  const ctx = await requireDashboardContext();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));

  const naveScope = naveScopeFromContext(ctx);
  const taskNaveFilter =
    naveScope !== null && naveScope.length > 0
      ? { naveId: { in: naveScope } }
      : naveScope !== null
        ? { naveId: { in: [] as string[] } }
        : undefined;

  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 5);

  const [openTimer, entries, processStyles, publishedPlanning] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { userId: ctx.userId, endedAt: null },
      include: { project: true, lamp: true, task: true },
    }),
    prisma.timeEntry.findMany({
      where: { userId: ctx.userId, startedAt: { gte: monday } },
      include: { project: true, lamp: true },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    getProcessBadgeStylesByCode(),
    prisma.planning.findMany({
      where: {
        status: PlanningStatus.PUBLISHED,
        weekStart: { gte: monday, lt: friday },
        ...(naveScope !== null ? { naveId: { in: naveScope } } : {}),
      },
      select: {
        assignments: {
          where: { personId: ctx.personId ?? "__none__" },
          select: {
            taskId: true,
            date: true,
            startSlot: true,
            endSlot: true,
          },
          orderBy: [{ date: "asc" }, { startSlot: "asc" }],
        },
      },
    }),
  ]);

  const processLabels = Object.fromEntries(
    [...processStyles.entries()].map(([code, s]) => [code, s.label]),
  );

  const taskRanges = new Map<string, string[]>();
  const taskSortKey = new Map<string, number>();
  let orderCursor = 0;
  for (const planning of publishedPlanning) {
    for (const assignment of planning.assignments) {
      const label = `${weekdayLabel(assignment.date)} ${rangeLabel(
        assignment.startSlot,
        assignment.endSlot,
      )}`;
      const existing = taskRanges.get(assignment.taskId) ?? [];
      existing.push(label);
      taskRanges.set(assignment.taskId, existing);
      if (!taskSortKey.has(assignment.taskId)) {
        taskSortKey.set(assignment.taskId, orderCursor++);
      }
    }
  }

  const assignedTaskIds = [...taskRanges.keys()];
  const assignedTasks =
    assignedTaskIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: {
            id: { in: assignedTaskIds },
            isCompleted: false,
            project: { isActive: true },
            ...(taskNaveFilter ?? {}),
          },
          select: {
            id: true,
            projectId: true,
            process: true,
            lampId: true,
            order: true,
            project: { select: { id: true, name: true } },
            lamp: { select: { id: true, name: true } },
          },
        });

  const workerQueue = assignedTasks
    .map((t) => ({
      id: t.id,
      projectId: t.projectId,
      projectName: t.project.name,
      lampId: t.lampId,
      lampName: t.lamp.name,
      process: t.process,
      order: t.order,
      plannedRanges: taskRanges.get(t.id) ?? [],
    }))
    .sort((a, b) => (taskSortKey.get(a.id) ?? 0) - (taskSortKey.get(b.id) ?? 0));

  const projects = Array.from(
    workerQueue.reduce(
      (acc, t) => {
        const project = acc.get(t.projectId) ?? {
          id: t.projectId,
          name: t.projectName,
          lamps: new Map<string, { id: string; name: string }>(),
          tasks: [] as { id: string; process: string; lampId: string }[],
        };
        project.lamps.set(t.lampId, { id: t.lampId, name: t.lampName });
        project.tasks.push({ id: t.id, process: t.process, lampId: t.lampId });
        acc.set(t.projectId, project);
        return acc;
      },
      new Map<
        string,
        {
          id: string;
          name: string;
          lamps: Map<string, { id: string; name: string }>;
          tasks: { id: string; process: string; lampId: string }[];
        }
      >(),
    ).values(),
  ).map((p) => ({
    id: p.id,
    name: p.name,
    lamps: [...p.lamps.values()],
    tasks: p.tasks,
  }));

  const nextTask = workerQueue[0] ?? null;

  const totalWeek = entries.reduce((acc, e) => acc + (e.hours ?? 0), 0);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Mis horas"
        description={`Total semana: ${totalWeek.toFixed(2)}h`}
      />

      <TaskQueuePanel
        nextTask={nextTask}
        queue={workerQueue}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          lamps: p.lamps,
          tasks: p.tasks,
        }))}
        openTimer={
          openTimer
            ? {
                id: openTimer.id,
                startedAt: openTimer.startedAt.toISOString(),
                taskId: openTimer.taskId ?? null,
                projectName: openTimer.project?.name ?? "Sin proyecto",
              }
            : null
        }
        processLabels={processLabels}
      />

      <Card>
        <CardHeader>
          <CardTitle>Esta semana</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EntriesList
            entries={entries.map((e) => ({
              id: e.id,
              project: e.project?.name ?? "—",
              lamp: e.lamp?.name ?? null,
              process: e.process,
              startedAt: e.startedAt.toISOString(),
              endedAt: e.endedAt?.toISOString() ?? null,
              hours: e.hours,
              source: e.source,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
