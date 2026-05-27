import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
} from "@/lib/week";
import {
  getActiveProjectsWithLoad,
  getActualHoursForWeek,
  getPlanningForWeek,
  getProcessDefinitionsByCode,
  type ActualHourEntry,
} from "@/features/planning/queries";
import {
  buildPlanningTimeline,
  type PlanningAssignmentSlice,
} from "@/features/planning/planning-timeline";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProcessBadge } from "@/components/process-badge";
import { DryWaitBadge } from "@/components/dry-wait-badge";
import { PersonAvatar } from "@/components/person-avatar";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  formatTimeRangeFromStartAndHours,
  riskFromPlannedEnd,
} from "@/lib/format";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import { getPlanningWeekMeta } from "@/features/planning/queries";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";
import { Role } from "@/generated/prisma";
import { TaskProgressActionsPanel } from "@/features/time-tracking/task-progress-actions-panel";
import { formatActualEntrySummaryLabel } from "@/features/time-tracking/entry-label";
import { slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import { toIsoUtcFromDateAndHour } from "@/lib/datetime-local";

export default async function ProyectoPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);
  const viewMode = await getPlanningViewModeForContext(ctx);
  const naveScope = naveScopeFromContext(ctx);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [projects, processByCode] = await Promise.all([
    getActiveProjectsWithLoad(naveScope),
    getProcessDefinitionsByCode(),
  ]);

  const [planning, actualEntries] = await Promise.all([
    getPlanningForWeek({
      naveScope,
      weekStart,
      viewMode,
    }),
    getActualHoursForWeek({
      naveScope,
      weekStart,
    }),
  ]);
  const assignments = (planning?.assignments ?? []) as PlanningAssignmentSlice[];

  const planningMeta =
    view === "plan"
      ? await getPlanningWeekMeta({ naveScope, weekStart })
      : null;
  const hiddenDraft =
    view === "plan" &&
    viewMode === "published_only" &&
    planningMeta?.status === "DRAFT" &&
    assignments.length === 0;
  const noPublished =
    view === "plan" &&
    viewMode === "published_only" &&
    !planningMeta &&
    assignments.length === 0;

  // Build per-project data
  const byProject = new Map<string, PlanningAssignmentSlice[]>();
  const plannedEndByProject = new Map<string, Date>();
  for (const a of assignments) {
    const list = byProject.get(a.task.projectId) ?? [];
    list.push(a);
    byProject.set(a.task.projectId, list);
    const cur = plannedEndByProject.get(a.task.projectId);
    if (!cur || a.date > cur) plannedEndByProject.set(a.task.projectId, a.date);
  }

  const actualByProject = new Map<string, ActualHourEntry[]>();
  for (const e of actualEntries) {
    if (!e.project) continue;
    const list = actualByProject.get(e.project.id) ?? [];
    list.push(e);
    actualByProject.set(e.project.id, list);
  }

  const projectIdsWithData = new Set([
    ...byProject.keys(),
    ...actualByProject.keys(),
  ]);
  const plannedByTask = buildPlannedHoursByTask(assignments);
  const plannedDueByTask = buildPlannedDueHoursByTask(assignments, todayIso);
  const actualByTask = buildActualHoursByTask(actualEntries);
  const completedByTask = buildCompletedByTask(assignments, actualEntries);
  const plannedItemsByTask = buildPlanItemsByTask(assignments);
  const actualItemsByTask = buildActualItemsByTask(actualEntries);

  const projectsWithLoad = projects
    .map((p) => ({
      project: p,
      risk: riskFromPlannedEnd(p.deliveryDate, plannedEndByProject.get(p.id) ?? null),
      pending: p.tasks.reduce((acc, t) => acc + Math.max(0, t.estimatedHours - t.doneHours), 0),
      scheduledHours: (byProject.get(p.id) ?? []).reduce((acc, a) => acc + a.hours, 0),
      actualHours: (actualByProject.get(p.id) ?? []).reduce((acc, e) => acc + e.hours, 0),
    }))
    .filter((row) => row.pending > 0 || projectIdsWithData.has(row.project.id))
    .sort((a, b) => {
      const aDate = a.project.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDate = b.project.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por proyecto · S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle basePath="/dashboard/proyecto" view={view} week={weekIso} />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
          </div>
        }
      />

      {view === "plan" && (
        <PlanningEmptyNotice hiddenDraft={hiddenDraft} noPublished={noPublished} />
      )}

      {projectsWithLoad.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {view === "actual"
            ? "No hay registros de horas para esta semana."
            : "No hay proyectos con trabajo pendiente ni asignaciones esta semana."}
        </p>
      )}

      <div className="space-y-4">
        {projectsWithLoad.map((row) => {
          const workHours = view === "actual" ? row.actualHours : row.scheduledHours;
          const hoursLabel = view === "actual" ? "Registrado S" : "Asignado S";

          return (
            <Card key={row.project.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{row.project.name}</CardTitle>
                  <RiskBadge level={row.risk} />
                </div>
                <div className="text-xs text-muted-foreground flex gap-4">
                  <span>
                    Entrega:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {formatShortDate(row.project.deliveryDate)}
                    </span>
                  </span>
                  <span>
                    Días:{" "}
                    <span className="font-semibold text-foreground">
                      {daysUntil(row.project.deliveryDate) ?? "—"}
                    </span>
                  </span>
                  <span>
                    Pendiente:{" "}
                    <span className="font-semibold text-foreground">
                      {formatHours(row.pending)}
                    </span>
                  </span>
                  <span>
                    {hoursLabel}{week}:{" "}
                    <span className="font-semibold text-foreground">
                      {formatHours(workHours)}
                    </span>
                  </span>
                  <span className="font-mono text-xs">
                    {view === "plan" ? `Registro: ${formatHours(row.actualHours)}` : `Plan: ${formatHours(row.scheduledHours)}`}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {view === "actual" ? (
                  <ActualProjectTable
                    isAdmin={ctx.role === Role.ADMIN}
                    entries={actualByProject.get(row.project.id) ?? []}
                    processByCode={processByCode}
                    plannedByTask={plannedByTask}
                    plannedItemsByTask={plannedItemsByTask}
                    actualByTask={actualByTask}
                    plannedDueByTask={plannedDueByTask}
                    completedByTask={completedByTask}
                  />
                ) : (
                  <PlanProjectTable
                    isAdmin={ctx.role === Role.ADMIN}
                    timeline={buildPlanningTimeline(
                      byProject.get(row.project.id) ?? [],
                      processByCode,
                    )}
                    actualEntries={actualByProject.get(row.project.id) ?? []}
                    processByCode={processByCode}
                    actualByTask={actualByTask}
                    actualItemsByTask={actualItemsByTask}
                    plannedByTask={plannedByTask}
                    plannedDueByTask={plannedDueByTask}
                    completedByTask={completedByTask}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ActualProjectTable({
  isAdmin,
  entries,
  processByCode,
  plannedByTask,
  actualByTask,
  plannedItemsByTask,
  plannedDueByTask,
  completedByTask,
}: {
  isAdmin: boolean;
  entries: ActualHourEntry[];
  processByCode: Awaited<ReturnType<typeof getProcessDefinitionsByCode>>;
  plannedByTask: Map<string, number>;
  actualByTask: Map<string, number>;
  plannedItemsByTask: Map<string, ProgressStripe[]>;
  plannedDueByTask: Map<string, number>;
  completedByTask: Map<string, boolean>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead>Horario</TableHead>
          <TableHead>Operario</TableHead>
          <TableHead>Lámpara</TableHead>
          <TableHead>Proceso</TableHead>
          <TableHead className="text-right">h</TableHead>
          <TableHead>Progreso</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-4">
              Sin registros esta semana
            </TableCell>
          </TableRow>
        ) : (
          entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-mono text-xs">
                {formatShortDate(new Date(e.date + "T00:00:00Z"))}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatTimeRangeFromStartAndHours(e.startedAt, e.hours)}
              </TableCell>
              <TableCell>
                {e.person ? (
                  <div className="flex items-center gap-2">
                    <PersonAvatar
                      iniciales={e.person.iniciales}
                      color={e.person.color}
                      size={20}
                    />
                    <span className="text-xs">{e.person.nombre}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs">{e.lamp?.name ?? "—"}</TableCell>
              <TableCell>
                {e.process ? (
                  <ProcessBadge
                    code={e.process}
                    definition={processByCode.get(e.process)?.badge}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs font-semibold">
                {formatHours(e.hours)}
              </TableCell>
              <TableCell>
                {e.taskId ? (
                  <TaskProgressInline
                    progress={computeTaskProgress({
                      isCompleted: completedByTask.get(e.taskId) ?? false,
                      plannedHours: plannedByTask.get(e.taskId) ?? 0,
                      plannedDueHours: plannedDueByTask.get(e.taskId) ?? 0,
                      actualHours: actualByTask.get(e.taskId) ?? 0,
                      hasRunning: entries.some((x) => x.taskId === e.taskId && x.isRunning),
                    })}
                    stripes={plannedItemsByTask.get(e.taskId) ?? []}
                    actions={
                      <TaskProgressActionsPanel
                        taskId={e.taskId}
                        isCompleted={completedByTask.get(e.taskId) ?? false}
                        canManageCompletion={isAdmin}
                        timeEntry={{
                          entries: e.endedAt
                            ? [
                                {
                                  id: e.id,
                                  startedAt: e.startedAt.toISOString(),
                                  endedAt: e.endedAt.toISOString(),
                                  notes: e.notes,
                                  summaryLabel: formatActualEntrySummaryLabel(
                                    e.date,
                                    e.hours,
                                    e.process ?? e.task?.process,
                                  ),
                                  dateIso: e.date,
                                  hours: e.hours,
                                  process: e.process ?? e.task?.process ?? null,
                                  isRunning: e.isRunning,
                                },
                              ]
                            : [],
                          userId: e.userId,
                          projectId: e.project?.id ?? e.task?.projectId ?? "",
                          lampId: e.lamp?.id ?? e.task?.lampId ?? undefined,
                          taskId: e.taskId,
                          process: e.process ?? e.task?.process ?? undefined,
                          startedAt: e.startedAt.toISOString(),
                          endedAt: e.endedAt?.toISOString() ?? null,
                          notes: e.notes,
                          canEdit: isAdmin && Boolean(e.endedAt),
                          canCreate: isAdmin,
                          canDelete: isAdmin,
                        }}
                      />
                    }
                  />
                ) : (
                  <span className="text-[10px] text-muted-foreground">Sin tarea</span>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function PlanProjectTable({
  isAdmin,
  timeline,
  actualEntries,
  processByCode,
  plannedByTask,
  plannedDueByTask,
  actualByTask,
  actualItemsByTask,
  completedByTask,
}: {
  isAdmin: boolean;
  timeline: ReturnType<typeof buildPlanningTimeline>;
  actualEntries: ActualHourEntry[];
  processByCode: Awaited<ReturnType<typeof getProcessDefinitionsByCode>>;
  plannedByTask: Map<string, number>;
  plannedDueByTask: Map<string, number>;
  actualByTask: Map<string, number>;
  actualItemsByTask: Map<string, ProgressStripe[]>;
  completedByTask: Map<string, boolean>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead>Horario</TableHead>
          <TableHead>Operario</TableHead>
          <TableHead>Lámpara</TableHead>
          <TableHead>Proceso</TableHead>
          <TableHead className="text-right">h</TableHead>
          <TableHead>Progreso</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {timeline.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-4">
              Sin asignaciones esta semana
            </TableCell>
          </TableRow>
        ) : (
          timeline.map((item) =>
            item.kind === "dry-wait" ? (
              <TableRow key={item.id} className="bg-amber-50/50">
                <TableCell className="font-mono text-xs">{formatShortDate(item.date)}</TableCell>
                <TableCell className="font-mono text-xs text-amber-900">{item.scheduleLabel}</TableCell>
                <TableCell className="text-xs text-muted-foreground">—</TableCell>
                <TableCell className="text-xs">{item.lampName ?? "—"}</TableCell>
                <TableCell>
                  <DryWaitBadge
                    afterProcess={item.afterProcess}
                    waitHours={item.waitHours}
                    processDefinition={processByCode.get(item.afterProcess)?.badge}
                  />
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-muted-foreground">—</TableCell>
                <TableCell />
              </TableRow>
            ) : (() => {
              const planStartedAt = toIsoUtcFromDateAndHour(
                item.assignment.date,
                slotToHour(item.assignment.startSlot),
              );
              const planEndedAt = toIsoUtcFromDateAndHour(
                item.assignment.date,
                slotEndToHour(item.assignment.endSlot),
              );
              const assignmentDateIso = item.assignment.date.toISOString().slice(0, 10);
              const planStripe = {
                id: item.assignment.id,
                label: `${formatShortDate(item.assignment.date)} · ${rangeLabel(
                  item.assignment.startSlot,
                  item.assignment.endSlot,
                )} · ${formatHours(item.assignment.hours)} · ${item.assignment.process}`,
                kind: "plan" as const,
              };
              const taskEntries = actualEntries
                .filter(
                  (entry) =>
                    entry.taskId === item.assignment.task.id &&
                    entry.date === assignmentDateIso &&
                    entry.endedAt,
                )
                .map((entry) => ({
                  id: entry.id,
                  startedAt: entry.startedAt.toISOString(),
                  endedAt: entry.endedAt!.toISOString(),
                  notes: entry.notes,
                  dateIso: entry.date,
                  hours: entry.hours,
                  process: entry.process ?? entry.task?.process ?? null,
                }));
              return (
              <TableRow key={item.assignment.id}>
                <TableCell className="font-mono text-xs">{formatShortDate(item.assignment.date)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {rangeLabel(item.assignment.startSlot, item.assignment.endSlot)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <PersonAvatar
                      iniciales={item.assignment.person.iniciales}
                      color={item.assignment.person.color}
                      size={20}
                    />
                    <span className="text-xs">
                      {item.assignment.person.alias ?? item.assignment.person.nombre}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{item.assignment.task.lamp?.name ?? "—"}</TableCell>
                <TableCell>
                  <ProcessBadge
                    code={item.assignment.process}
                    definition={processByCode.get(item.assignment.process)?.badge}
                  />
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-semibold">
                  {formatHours(item.assignment.hours)}
                </TableCell>
                <TableCell>
                  <TaskProgressInline
                    progress={computeTaskProgress({
                      isCompleted: completedByTask.get(item.assignment.task.id) ?? false,
                      plannedHours: plannedByTask.get(item.assignment.task.id) ?? 0,
                      plannedDueHours: plannedDueByTask.get(item.assignment.task.id) ?? 0,
                      actualHours: actualByTask.get(item.assignment.task.id) ?? 0,
                      hasRunning: actualItemsByTask.get(item.assignment.task.id)?.some((x) => x.isRunning) ?? false,
                    })}
                    stripes={[planStripe]}
                    actions={
                      <TaskProgressActionsPanel
                        taskId={item.assignment.task.id}
                        isCompleted={completedByTask.get(item.assignment.task.id) ?? false}
                        canManageCompletion={isAdmin}
                        timeEntry={{
                          entries: taskEntries,
                          personId: item.assignment.person.id,
                          projectId: item.assignment.task.projectId,
                          lampId: item.assignment.task.lampId,
                          taskId: item.assignment.task.id,
                          process: item.assignment.process,
                          startedAt: planStartedAt,
                          endedAt: planEndedAt,
                          defaultStartedAt: planStartedAt,
                          defaultEndedAt: planEndedAt,
                          canEdit: isAdmin,
                          canCreate: isAdmin,
                          canDelete: isAdmin,
                        }}
                      />
                    }
                  />
                </TableCell>
              </TableRow>
              );
            })(),
          )
        )}
      </TableBody>
    </Table>
  );
}

function buildPlannedHoursByTask(assignments: PlanningAssignmentSlice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    map.set(assignment.task.id, (map.get(assignment.task.id) ?? 0) + assignment.hours);
  }
  return map;
}

function buildPlannedDueHoursByTask(
  assignments: PlanningAssignmentSlice[],
  cutoffIso: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.date.toISOString().slice(0, 10) > cutoffIso) continue;
    map.set(assignment.task.id, (map.get(assignment.task.id) ?? 0) + assignment.hours);
  }
  return map;
}

function buildActualHoursByTask(entries: ActualHourEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.taskId) continue;
    map.set(entry.taskId, (map.get(entry.taskId) ?? 0) + entry.hours);
  }
  return map;
}

function buildPlanItemsByTask(assignments: PlanningAssignmentSlice[]): Map<string, ProgressStripe[]> {
  const map = new Map<string, ProgressStripe[]>();
  for (const assignment of assignments) {
    const list = map.get(assignment.task.id) ?? [];
    list.push({
      id: assignment.id,
      label: `${formatShortDate(assignment.date)} · ${rangeLabel(
        assignment.startSlot,
        assignment.endSlot,
      )} · ${formatHours(assignment.hours)}`,
      kind: "plan",
    });
    map.set(assignment.task.id, list);
  }
  return map;
}

function buildActualItemsByTask(entries: ActualHourEntry[]): Map<string, ProgressStripe[]> {
  const map = new Map<string, ProgressStripe[]>();
  for (const entry of entries) {
    if (!entry.taskId) continue;
    const list = map.get(entry.taskId) ?? [];
    list.push({
      id: entry.id,
      label: `${formatShortDate(new Date(entry.date + "T00:00:00Z"))} · ${formatTimeRangeFromStartAndHours(
        entry.startedAt,
        entry.hours,
      )} · ${formatHours(entry.hours)}`,
      kind: "actual",
      isRunning: entry.isRunning,
    });
    map.set(entry.taskId, list);
  }
  return map;
}

function buildCompletedByTask(
  assignments: PlanningAssignmentSlice[],
  entries: ActualHourEntry[],
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const assignment of assignments) {
    map.set(assignment.task.id, assignment.task.isCompleted);
  }
  for (const entry of entries) {
    if (!entry.taskId || !entry.task) continue;
    map.set(entry.taskId, entry.task.isCompleted);
  }
  return map;
}

// (helper removed: was an accidental duplicate wrapper)

function buildPlanItemsByTaskFromTimelineRow(item: ReturnType<typeof buildPlanningTimeline>[number]): ProgressStripe[] {
  if (item.kind !== "work") return [];
  return [
    {
      id: item.assignment.id,
      kind: "plan",
      label: `${formatShortDate(item.assignment.date)} · ${rangeLabel(
        item.assignment.startSlot,
        item.assignment.endSlot,
      )} · ${formatHours(item.assignment.hours)}`,
    },
  ];
}
