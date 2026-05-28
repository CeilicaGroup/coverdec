import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import { Role } from "@/generated/prisma";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import {
  getAbsencesForRange,
  getActualHoursForWeek,
  getNavePersonnel,
  getPlanningForWeek,
  getProcessDefinitionsByCode,
  toPlanningAssignmentSlices,
  type ActualHourEntry,
} from "@/features/planning/queries";
import {
  buildPlanningTimeline,
  filterTimelineForPerson,
  type PlanningAssignmentSlice,
} from "@/features/planning/planning-timeline";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { PersonAvatar } from "@/components/person-avatar";
import { ProcessBadge } from "@/components/process-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import { formatHours, formatShortDate, formatTimeRangeFromStartAndHours } from "@/lib/format";
import { PrintToolbar } from "./print-toolbar";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import { getPlanningWeekMeta } from "@/features/planning/queries";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";
import { TaskLampBastidor } from "@/components/task-lamp-bastidor";
import { getTaskLampFrameLabel } from "@/features/planning/task-lamp-frame";
import { TaskProgressActionsPanel } from "@/features/time-tracking/task-progress-actions-panel";
import { formatActualEntrySummaryLabel } from "@/features/time-tracking/entry-label";
import { toIsoUtcFromDateAndHour } from "@/lib/datetime-local";

export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);
  const viewMode = await getPlanningViewModeForContext(ctx);
  const naveScope = naveScopeFromContext(ctx);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [allPeople, absences, processByCode] = await Promise.all([
    getNavePersonnel(naveScopeFromContext(ctx)),
    getAbsencesForRange(days[0], days[4]),
    getProcessDefinitionsByCode(),
  ]);

  const people =
    ctx.role === Role.OPERARIO && ctx.personId
      ? allPeople.filter((p) => p.id === ctx.personId)
      : allPeople;

  const [planning, rawActualEntries] = await Promise.all([
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
  const planningAssignments = toPlanningAssignmentSlices(
    planning?.assignments ?? [],
  );
  const actualEntries =
    ctx.role === Role.OPERARIO && ctx.personId
      ? rawActualEntries.filter((e) => e.personId === ctx.personId)
      : rawActualEntries;
  const plannedByTask = buildHoursByTaskFromPlan(planningAssignments);
  const plannedDueByTask = buildDueHoursByTaskFromPlan(planningAssignments, todayIso);
  const actualByTask = buildHoursByTaskFromActual(actualEntries);
  const completedByTask = buildCompletedByTask(planningAssignments, actualEntries);
  const plannedItemsByTask = buildItemsByTaskFromPlan(planningAssignments);
  const actualItemsByTask = buildItemsByTaskFromActual(actualEntries);

  const planningMeta =
    view === "plan"
      ? await getPlanningWeekMeta({ naveScope, weekStart })
      : null;
  const hiddenDraft =
    view === "plan" &&
    viewMode === "published_only" &&
    planningMeta?.status === "DRAFT" &&
    planningAssignments.length === 0;
  const noPublished =
    view === "plan" &&
    viewMode === "published_only" &&
    !planningMeta &&
    planningAssignments.length === 0;

  const fullTimeline = buildPlanningTimeline(planningAssignments, processByCode);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por persona · S${week} · ${year}`}
        description={
          ctx.role === Role.OPERARIO && ctx.personId
            ? `${formatWeekRange(weekStart)} · Tu semana`
            : `${formatWeekRange(weekStart)} · Equipo completo · imprimir para reparto en nave`
        }
        actions={
          <div className="flex items-center gap-2 no-print">
            <ViewToggle basePath="/dashboard/persona" view={view} week={weekIso} />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
            <PrintToolbar />
          </div>
        }
      />

      {view === "plan" && (
        <PlanningEmptyNotice hiddenDraft={hiddenDraft} noPublished={noPublished} />
      )}
      {view === "plan" &&
        planningAssignments.length === 0 &&
        !hiddenDraft &&
        !noPublished && (
        <p className="text-sm text-muted-foreground">
          No hay planning para esta semana. Genera un borrador desde Resumen.
        </p>
      )}
      {view === "actual" && actualEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay registros de horas para esta semana.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-4 print:grid-cols-1">
        {people.map((p) => {
          const personAbsences = absences.filter((a) => a.personId === p.id);

          if (view === "actual") {
            const entries = actualEntries.filter((e) => e.personId === p.id);
            const total = entries.reduce((acc, e) => acc + e.hours, 0);
            return (
              <PersonCard
                key={p.id}
                person={p}
                total={total}
                absences={personAbsences}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Día</TableHead>
                      <TableHead>Horario</TableHead>
                      <TableHead>Proyecto</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead className="text-right">h</TableHead>
                      <TableHead>Progreso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Sin registros
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
                            <div className="font-semibold text-xs">
                              {e.project?.name ?? "—"}
                            </div>
                            {e.lamp?.name ? (
                              <div className="text-[10px] text-muted-foreground">
                                {e.lamp.name}
                              </div>
                            ) : null}
                            <TaskLampBastidor
                              label={e.task ? getTaskLampFrameLabel(e.task) : null}
                            />
                          </TableCell>
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
                                  hasRunning: entries.some(
                                    (x) => x.taskId === e.taskId && x.isRunning,
                                  ),
                                })}
                                stripes={plannedItemsByTask.get(e.taskId) ?? []}
                                actions={
                                  <TaskProgressActionsPanel
                                    taskId={e.taskId}
                                    isCompleted={completedByTask.get(e.taskId) ?? false}
                                    canManageCompletion={ctx.role === Role.ADMIN}
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
                                      canEdit: Boolean(e.endedAt),
                                      canCreate: ctx.role === Role.ADMIN,
                                      canDelete: true,
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
              </PersonCard>
            );
          }

          // Plan view
          const items = filterTimelineForPerson(fullTimeline, p.id).filter(
            (i) => i.kind === "work",
          );
          const total = items.reduce(
            (acc, x) => acc + (x.kind === "work" ? x.assignment.hours : 0),
            0,
          );
          return (
            <PersonCard key={p.id} person={p} total={total} absences={personAbsences}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead>Horario</TableHead>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Proceso</TableHead>
                    <TableHead className="text-right">h</TableHead>
                    <TableHead>Progreso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        Sin asignaciones
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => {
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
                        <TableCell className="font-mono text-xs">
                          {formatShortDate(item.assignment.date)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {rangeLabel(item.assignment.startSlot, item.assignment.endSlot)}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-xs">
                            {item.assignment.task.project.name}
                          </div>
                          {item.assignment.task.lamp?.name ? (
                            <div className="text-[10px] text-muted-foreground">
                              {item.assignment.task.lamp.name}
                            </div>
                          ) : null}
                          <TaskLampBastidor
                            label={getTaskLampFrameLabel(item.assignment.task)}
                          />
                        </TableCell>
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
                              hasRunning: actualEntries.some(
                                (x) => x.taskId === item.assignment.task.id && x.isRunning,
                              ),
                            })}
                            stripes={[planStripe]}
                            actions={
                              <TaskProgressActionsPanel
                                taskId={item.assignment.task.id}
                                isCompleted={completedByTask.get(item.assignment.task.id) ?? false}
                                canManageCompletion={ctx.role === Role.ADMIN}
                                timeEntry={{
                                  entries: taskEntries,
                                  personId: item.assignment.personId,
                                  projectId: item.assignment.task.projectId,
                                  lampId: item.assignment.task.lampId,
                                  taskId: item.assignment.task.id,
                                  process: item.assignment.process,
                                  startedAt: planStartedAt,
                                  endedAt: planEndedAt,
                                  defaultStartedAt: planStartedAt,
                                  defaultEndedAt: planEndedAt,
                                  canEdit: ctx.role === Role.ADMIN,
                                  canCreate: ctx.role === Role.ADMIN,
                                  canDelete: ctx.role === Role.ADMIN,
                                }}
                              />
                            }
                          />
                        </TableCell>
                      </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </PersonCard>
          );
        })}
      </div>
    </div>
  );
}

function buildHoursByTaskFromPlan(assignments: PlanningAssignmentSlice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    map.set(assignment.task.id, (map.get(assignment.task.id) ?? 0) + assignment.hours);
  }
  return map;
}

function buildDueHoursByTaskFromPlan(
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

function buildHoursByTaskFromActual(entries: ActualHourEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.taskId) continue;
    map.set(entry.taskId, (map.get(entry.taskId) ?? 0) + entry.hours);
  }
  return map;
}

function buildItemsByTaskFromPlan(assignments: PlanningAssignmentSlice[]): Map<string, ProgressStripe[]> {
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

function buildItemsByTaskFromActual(entries: ActualHourEntry[]): Map<string, ProgressStripe[]> {
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
    if (!entry.taskId) continue;
    if (!entry.task) continue;
    map.set(entry.taskId, entry.task.isCompleted);
  }
  return map;
}

function PersonCard({
  person,
  total,
  absences,
  children,
}: {
  person: { id: string; nombre: string; iniciales: string; color: string; notes?: string | null };
  total: number;
  absences: { date: Date }[];
  children: React.ReactNode;
}) {
  return (
    <Card className="break-inside-avoid print:border print:shadow-none">
      <CardHeader
        className="flex flex-row items-center gap-3 py-3"
        style={{
          background: person.color,
          color: "white",
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        }}
      >
        <PersonAvatar
          iniciales={person.iniciales}
          color={person.color}
          size={32}
          className="ring-2 ring-white/70"
        />
        <div className="flex-1">
          <CardTitle className="text-white text-base">{person.nombre}</CardTitle>
          <div className="text-[11px] text-white/80">{person.notes ?? ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-white/70">Semana</div>
          <div className="font-bold text-white">{formatHours(total)}</div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {absences.length > 0 && (
          <div className="px-3 py-2 text-xs bg-muted border-b">
            Ausencias:{" "}
            {absences.map((a) => formatShortDate(a.date)).join(", ")}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
