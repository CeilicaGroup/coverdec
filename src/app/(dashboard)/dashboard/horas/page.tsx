import { PlanningStatus, Role, TaskSystemKind } from "@/generated/prisma";
import { naveScopeFromContext } from "@/lib/nave-filter";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { getPlanningViewModeForContext } from "@/features/planning/planning-view-mode-server";
import { productiveTaskSystemKindWhere } from "@/features/planning/productive-task-filter";
import { getMondayOf } from "@/lib/week";
import { PageHeader } from "../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntriesList } from "./entries-list";
import { getProcessBadgeStylesByCode } from "@/features/planning/queries";
import { TaskQueuePanel } from "./task-queue-panel";
import { AdHocTasksPanel } from "./ad-hoc-tasks-panel";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import { planningRangeToDatetimeLocal } from "@/lib/datetime-local";
import { workOrderGroupKey } from "@/features/work-orders/group-key";
import type { ManualBreakScheduleSnapshot } from "./task-queue-panel";

function weekdayLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(".", "");
}

function formatTaskMeasure(input: {
  lamp: { surfaceM2: number | null; units: number };
  lampElement: { surfaceM2: number | null; units: number } | null;
}): string {
  const lampElementSurface = input.lampElement?.surfaceM2 ?? null;
  const lampElementUnits = input.lampElement?.units ?? 1;
  if (lampElementSurface && lampElementSurface > 0) {
    return `${lampElementSurface.toFixed(2)} m² · ${lampElementUnits} uds`;
  }

  const lampSurface = input.lamp.surfaceM2 ?? null;
  if (lampSurface && lampSurface > 0) {
    return `${lampSurface.toFixed(2)} m² · ${Math.max(1, input.lamp.units)} uds`;
  }

  return `${Math.max(1, input.lampElement?.units ?? input.lamp.units)} uds`;
}

export default async function HorasPage() {
  const ctx = await requireDashboardContext();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const monday = getMondayOf(today);

  const naveScope = naveScopeFromContext(ctx);
  const taskNaveFilter =
    naveScope !== null && naveScope.length > 0
      ? { naveId: { in: naveScope } }
      : naveScope !== null
        ? { naveId: { in: [] as string[] } }
        : undefined;

  const viewMode = await getPlanningViewModeForContext(ctx);
  const planningStatusWhere: { status?: PlanningStatus } =
    viewMode === "include_draft"
      ? {}
      : { status: PlanningStatus.PUBLISHED };
  const scheduleOverrideStart = new Date(monday);
  scheduleOverrideStart.setUTCDate(scheduleOverrideStart.getUTCDate() - 30);
  const scheduleOverrideEnd = new Date(monday);
  scheduleOverrideEnd.setUTCDate(scheduleOverrideEnd.getUTCDate() + 120);

  const [openTimer, entries, processStyles, weekPlanning, adHocParticipantTasks, personSchedule] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { userId: ctx.userId, endedAt: null },
      include: { project: true, lamp: true, task: true },
    }),
    prisma.timeEntry.findMany({
      where: { userId: ctx.userId, startedAt: { gte: monday } },
      include: { project: true, lamp: true },
      orderBy: { startedAt: "desc" },
    }),
    getProcessBadgeStylesByCode(),
    prisma.planning.findMany({
      where: {
        ...planningStatusWhere,
        weekStart: { gte: monday },
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
    ctx.personId
      ? prisma.task.findMany({
          where: {
            systemKind: TaskSystemKind.AD_HOC,
            isCompleted: false,
            participants: { some: { personId: ctx.personId } },
            project: { isActive: true },
            ...(taskNaveFilter ?? {}),
          },
          select: {
            id: true,
            projectId: true,
            lampId: true,
            process: true,
            notes: true,
            estimatedHours: true,
            project: { select: { name: true } },
            assignments: {
              where: { personId: ctx.personId },
              select: { date: true, startSlot: true, endSlot: true },
              orderBy: [{ date: "asc" }, { startSlot: "asc" }],
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    ctx.personId
      ? prisma.person.findUnique({
          where: { id: ctx.personId },
          select: {
            workWindows: {
              select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
            },
            scheduleOverrides: {
              where: {
                date: {
                  gte: scheduleOverrideStart,
                  lte: scheduleOverrideEnd,
                },
              },
              select: {
                date: true,
                windows: {
                  select: { startMinutes: true, endMinutes: true },
                  orderBy: { startMinutes: "asc" },
                },
              },
              orderBy: { date: "asc" },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const manualBreakSchedule: ManualBreakScheduleSnapshot | null =
    personSchedule && personSchedule.workWindows.length > 0
      ? {
          weekly: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            windows: personSchedule.workWindows
              .filter((window) => window.dayOfWeek === dayOfWeek)
              .sort((a, b) => a.startMinutes - b.startMinutes)
              .map((window) => ({
                startMinutes: window.startMinutes,
                endMinutes: window.endMinutes,
              })),
          })),
          overrides: personSchedule.scheduleOverrides.map((override) => ({
            dateIso: override.date.toISOString().slice(0, 10),
            windows: override.windows.map((window) => ({
              startMinutes: window.startMinutes,
              endMinutes: window.endMinutes,
            })),
          })),
        }
      : null;

  const processLabels = Object.fromEntries(
    [...processStyles.entries()].map(([code, s]) => [code, s.label]),
  );

  const taskRanges = new Map<string, string[]>();
  const taskDateRanges = new Map<string, { startedAt: string; endedAt: string }[]>();
  const taskSortKey = new Map<string, number>();
  let orderCursor = 0;
  for (const planning of weekPlanning) {
    for (const assignment of planning.assignments) {
      const label = `${weekdayLabel(assignment.date)} ${rangeLabel(
        assignment.startSlot,
        assignment.endSlot,
      )}`;
      const existing = taskRanges.get(assignment.taskId) ?? [];
      existing.push(label);
      taskRanges.set(assignment.taskId, existing);
      const dateRanges = taskDateRanges.get(assignment.taskId) ?? [];
      dateRanges.push({
        ...planningRangeToDatetimeLocal(
          assignment.date,
          slotToHour(assignment.startSlot),
          slotEndToHour(assignment.endSlot),
        ),
      });
      taskDateRanges.set(assignment.taskId, dateRanges);
      if (!taskSortKey.has(assignment.taskId)) {
        taskSortKey.set(assignment.taskId, orderCursor++);
      }
    }
  }

  const assignedTaskIds = [...taskRanges.keys()];
  const now = new Date();
  const assignedTasks =
    assignedTaskIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: {
            id: { in: assignedTaskIds },
            isCompleted: false,
            ...productiveTaskSystemKindWhere(),
            project: { isActive: true },
            ...(taskNaveFilter ?? {}),
          },
          select: {
            id: true,
            projectId: true,
            process: true,
            lampId: true,
            order: true,
            systemKind: true,
            workOrderId: true,
            estimatedHours: true,
            project: { select: { id: true, name: true } },
            lamp: {
              select: {
                id: true,
                name: true,
                surfaceM2: true,
                units: true,
                elementType: { select: { id: true } },
              },
            },
            lampElement: {
              select: {
                label: true,
                surfaceM2: true,
                units: true,
                elementType: { select: { id: true } },
              },
            },
            workOrder: { select: { number: true, status: true } },
          },
        });

  const workOrderIds = [
    ...new Set(assignedTasks.map((t) => t.workOrderId).filter((id): id is string => Boolean(id))),
  ];
  const [workOrderHoursRows, workOrderTasksForProgress] = await Promise.all([
    workOrderIds.length === 0
      ? Promise.resolve([])
      : prisma.task.groupBy({
          by: ["workOrderId"],
          where: { workOrderId: { in: workOrderIds } },
          _sum: { estimatedHours: true },
        }),
    workOrderIds.length === 0
      ? Promise.resolve([])
      : prisma.task.findMany({
          where: { workOrderId: { in: workOrderIds } },
          select: {
            workOrderId: true,
            lampId: true,
            lampElementId: true,
            isCompleted: true,
          },
        }),
  ]);
  const workOrderEstimatedHours = new Map(
    workOrderHoursRows
      .filter((row) => row.workOrderId != null)
      .map((row) => [row.workOrderId!, row._sum.estimatedHours ?? 0]),
  );

  /** Por OT: elementos hechos / total (clave = lampElementId ?? lampId). */
  const workOrderElementProgress = new Map<
    string,
    { done: number; total: number }
  >();
  {
    const byWo = new Map<
      string,
      Map<string, { total: number; completed: number }>
    >();
    for (const task of workOrderTasksForProgress) {
      if (!task.workOrderId) continue;
      const elementKey = task.lampElementId ?? task.lampId;
      let elements = byWo.get(task.workOrderId);
      if (!elements) {
        elements = new Map();
        byWo.set(task.workOrderId, elements);
      }
      const entry = elements.get(elementKey) ?? { total: 0, completed: 0 };
      entry.total += 1;
      if (task.isCompleted) entry.completed += 1;
      elements.set(elementKey, entry);
    }
    for (const [woId, elements] of byWo) {
      let done = 0;
      for (const entry of elements.values()) {
        if (entry.completed === entry.total) done += 1;
      }
      workOrderElementProgress.set(woId, { done, total: elements.size });
    }
  }

  const groupedPendingCount = new Map<string, number>();
  for (const task of assignedTasks) {
    if (!task.workOrderId) continue;
    groupedPendingCount.set(
      task.workOrderId,
      (groupedPendingCount.get(task.workOrderId) ?? 0) + 1,
    );
  }

  const assignedLampIds = [...new Set(assignedTasks.map((t) => t.lampId))];
  const [lampTasks, processDefs, lastEndedByTaskRaw] = await Promise.all([
    assignedLampIds.length === 0
      ? []
      : prisma.task.findMany({
          where: { lampId: { in: assignedLampIds } },
          select: { id: true, lampId: true, order: true, process: true, isCompleted: true },
          orderBy: [{ lampId: "asc" }, { order: "asc" }],
        }),
    prisma.processDefinition.findMany({
      select: { code: true, waitHours: true },
    }),
    assignedLampIds.length === 0
      ? []
      : prisma.timeEntry.groupBy({
          by: ["taskId"],
          where: {
            userId: ctx.userId,
            taskId: { not: null },
            endedAt: { not: null },
          },
          _max: { endedAt: true },
        }),
  ]);
  const waitHoursByProcess = new Map(processDefs.map((p) => [p.code, p.waitHours]));
  const lastEndedByTask = new Map(
    lastEndedByTaskRaw
      .filter((x) => x.taskId && x._max.endedAt)
      .map((x) => [x.taskId!, x._max.endedAt!]),
  );
  const tasksByLamp = new Map<string, typeof lampTasks>();
  for (const task of lampTasks) {
    const list = tasksByLamp.get(task.lampId) ?? [];
    list.push(task);
    tasksByLamp.set(task.lampId, list);
  }

  function blockedReasonForTask(task: (typeof assignedTasks)[number]): string | null {
    const lampList = (tasksByLamp.get(task.lampId) ?? []).sort((a, b) => a.order - b.order);
    const prev = [...lampList].reverse().find((x) => x.order < task.order);
    if (!prev) return null;
    if (!prev.isCompleted) {
      return `Bloqueada: aún no se ha completado ${processLabels[prev.process] ?? prev.process}.`;
    }
    const waitHours = waitHoursByProcess.get(prev.process) ?? 0;
    if (waitHours <= 0) return null;
    const prevEnded = lastEndedByTask.get(prev.id);
    if (!prevEnded) return null;
    const unlockAt = new Date(prevEnded.getTime() + waitHours * 3600000);
    if (unlockAt > now) {
      return `En espera por secado hasta ${unlockAt.toLocaleString("es-ES", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}.`;
    }
    return null;
  }

  const workerQueue = assignedTasks
    .map((t) => ({
      workOrderId: t.workOrderId,
      groupKey: workOrderGroupKey(t),
      id: t.id,
      projectId: t.projectId,
      projectName: t.project.name,
      lampId: t.lampId,
      lampName: t.lamp.name,
      elementLabel: t.lampElement?.label?.trim() || t.lamp.name,
      measureLabel: formatTaskMeasure({ lamp: t.lamp, lampElement: t.lampElement }),
      process: t.process,
      order: t.order,
      estimatedHours: t.estimatedHours,
      workOrderEstimatedHours: t.workOrderId
        ? (workOrderEstimatedHours.get(t.workOrderId) ?? null)
        : null,
      workOrderElementsDone: t.workOrderId
        ? (workOrderElementProgress.get(t.workOrderId)?.done ?? null)
        : null,
      workOrderElementsTotal: t.workOrderId
        ? (workOrderElementProgress.get(t.workOrderId)?.total ?? null)
        : null,
      plannedRanges: taskRanges.get(t.id) ?? [],
      plannedDateRanges: taskDateRanges.get(t.id) ?? [],
      blockedReason: blockedReasonForTask(t),
      workOrderNumber: t.workOrder?.number ?? null,
      workOrderStatus: t.workOrder?.status ?? null,
      groupPendingCount: t.workOrderId
        ? groupedPendingCount.get(t.workOrderId) ?? 1
        : 1,
    }))
    .sort((a, b) => (taskSortKey.get(a.id) ?? 0) - (taskSortKey.get(b.id) ?? 0));

  const projects = Array.from(
    workerQueue.reduce(
      (acc, t) => {
        const project = acc.get(t.projectId) ?? {
          id: t.projectId,
          name: t.projectName,
          lamps: new Map<string, { id: string; name: string }>(),
          tasks: [] as {
            id: string;
            process: string;
            lampId: string;
            workOrderId: string | null;
            groupKey: string | null;
            groupPendingCount: number;
            elementLabel: string;
            measureLabel: string;
          }[],
        };
        project.lamps.set(t.lampId, { id: t.lampId, name: t.lampName });
        project.tasks.push({
          id: t.id,
          process: t.process,
          lampId: t.lampId,
          workOrderId: t.workOrderId ?? null,
          groupKey: t.groupKey ?? null,
          groupPendingCount: t.groupPendingCount ?? 1,
          elementLabel: t.elementLabel,
          measureLabel: t.measureLabel,
        });
        acc.set(t.projectId, project);
        return acc;
      },
      new Map<
        string,
        {
          id: string;
          name: string;
          lamps: Map<string, { id: string; name: string }>;
          tasks: {
            id: string;
            process: string;
            lampId: string;
            workOrderId: string | null;
            groupKey: string | null;
            groupPendingCount: number;
            elementLabel: string;
            measureLabel: string;
          }[];
        }
      >(),
    ).values(),
  ).map((p) => ({
    id: p.id,
    name: p.name,
    lamps: [...p.lamps.values()],
    tasks: p.tasks,
  }));

  const nextTask = workerQueue.find((t) => !t.blockedReason) ?? workerQueue[0] ?? null;

  const adHocTasks = adHocParticipantTasks.map((task) => ({
    id: task.id,
    projectId: task.projectId,
    projectName: task.project.name,
    lampId: task.lampId,
    process: task.process,
    notes: task.notes,
    estimatedHours: task.estimatedHours,
    isPlanned: task.assignments.length > 0,
    plannedRanges: task.assignments.map(
      (assignment) =>
        `${weekdayLabel(assignment.date)} ${rangeLabel(
          assignment.startSlot,
          assignment.endSlot,
        )}`,
    ),
  }));

  const totalWeek = entries.reduce((acc, e) => acc + (e.hours ?? 0), 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Mis horas"
        description={`Total semana: ${totalWeek.toFixed(2)}h`}
      />

      <AdHocTasksPanel
        tasks={adHocTasks}
        processLabels={processLabels}
        openTimer={
          openTimer
            ? {
                id: openTimer.id,
                startedAt: openTimer.startedAt.toISOString(),
                taskId: openTimer.taskId ?? null,
              }
            : null
        }
      />

      <TaskQueuePanel
        nextTask={nextTask}
        queue={workerQueue}
        manualBreakSchedule={manualBreakSchedule}
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
            canEditAll={ctx.role === Role.ADMIN}
            entries={entries.map((e) => ({
              id: e.id,
              userId: e.userId,
              projectId: e.projectId,
              lampId: e.lampId,
              taskId: e.taskId,
              project: e.project?.name ?? "—",
              lamp: e.lamp?.name ?? null,
              process: e.process,
              startedAt: e.startedAt.toISOString(),
              endedAt: e.endedAt?.toISOString() ?? null,
              hours: e.hours,
              notes: e.notes,
              source: e.source,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
