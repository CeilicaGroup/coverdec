import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { WorkOrderBadge } from "@/components/work-order-badge";
import { TaskLampBastidor } from "@/components/task-lamp-bastidor";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";
import { rangeLabel, slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import {
  filterTimelineForPerson,
  type PlanningTimelineItem,
} from "@/features/planning/planning-timeline";
import { getTaskLampElementLabel } from "@/features/planning/task-lamp-frame";
import { withWorkOrderHighlight } from "@/features/work-orders/highlight";
import type { ActualHourEntry } from "@/features/planning/queries";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { TaskProgressActionsPanel } from "@/features/time-tracking/task-progress-actions-panel";
import { formatActualEntrySummaryLabel } from "@/features/time-tracking/entry-label";
import { toIsoUtcFromDateAndHour } from "@/lib/datetime-local";
import { formatHours, formatShortDate, formatTimeRangeFromStartAndHours } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PersonWeekListMaps {
  plannedByTask: Map<string, number>;
  plannedDueByTask: Map<string, number>;
  actualByTask: Map<string, number>;
  completedByTask: Map<string, boolean>;
  plannedItemsByTask: Map<string, ProgressStripe[]>;
}

interface PersonWeekListProps {
  view: "plan" | "actual";
  personId: string;
  fullTimeline: PlanningTimelineItem[];
  actualEntries: ActualHourEntry[];
  processByCode: Map<string, { badge?: ProcessBadgeStyle }>;
  maps: PersonWeekListMaps;
  canSeeRecords: boolean;
  canManageCompletion: boolean;
}

export function PersonWeekList({
  view,
  personId,
  fullTimeline,
  actualEntries,
  processByCode,
  maps,
  canSeeRecords,
  canManageCompletion,
}: PersonWeekListProps) {
  if (view === "actual") {
    const entries = actualEntries.filter((e) => e.personId === personId);
    if (entries.length === 0) {
      return (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin registros</p>
      );
    }

    return (
      <>
        <div className="hidden @3xl/person-week-card:block [&_[data-slot=table-container]]:overflow-x-visible">
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
              {entries.map((e) => (
                <TableRow
                  key={e.id}
                  {...withWorkOrderHighlight(e.task?.workOrder?.number)}
                >
                  <TableCell className="font-mono text-xs">
                    {formatShortDate(new Date(e.date + "T00:00:00Z"))}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatTimeRangeFromStartAndHours(e.startedAt, e.hours)}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-xs">{e.project?.name ?? "—"}</div>
                    {e.lamp?.name ? (
                      <div className="text-[10px] text-muted-foreground">{e.lamp.name}</div>
                    ) : null}
                    <TaskLampBastidor
                      label={e.task ? getTaskLampElementLabel(e.task) : null}
                    />
                  </TableCell>
                  <TableCell>
                    {e.process ? (
                      <div className="flex items-center gap-1 flex-wrap">
                        <ProcessBadge
                          code={e.process}
                          definition={processByCode.get(e.process)?.badge}
                        />
                        <WorkOrderBadge
                          number={e.task?.workOrder?.number}
                          status={e.task?.workOrder?.status}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {formatHours(e.hours)}
                  </TableCell>
                  <TableCell>
                    {e.taskId && canSeeRecords ? (
                      <TaskProgressInline
                        progress={computeTaskProgress({
                          isCompleted: maps.completedByTask.get(e.taskId) ?? false,
                          plannedHours: maps.plannedByTask.get(e.taskId) ?? 0,
                          plannedDueHours: maps.plannedDueByTask.get(e.taskId) ?? 0,
                          actualHours: maps.actualByTask.get(e.taskId) ?? 0,
                          hasRunning: entries.some(
                            (x) => x.taskId === e.taskId && x.isRunning,
                          ),
                        })}
                        stripes={maps.plannedItemsByTask.get(e.taskId) ?? []}
                        actions={
                          <TaskProgressActionsPanel
                            taskId={e.taskId}
                            isCompleted={maps.completedByTask.get(e.taskId) ?? false}
                            canManageCompletion={canManageCompletion}
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
                              canCreate: canManageCompletion,
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
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="@3xl/person-week-card:hidden space-y-3 p-3">
          {entries.map((e) => (
            <div
              key={e.id}
              className="rounded-lg border bg-card p-3 space-y-2"
              {...withWorkOrderHighlight(e.task?.workOrder?.number)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-xs">
                  <div>{formatShortDate(new Date(e.date + "T00:00:00Z"))}</div>
                  <div className="text-muted-foreground">
                    {formatTimeRangeFromStartAndHours(e.startedAt, e.hours)}
                  </div>
                </div>
                <div className="font-mono text-xs font-semibold">{formatHours(e.hours)}</div>
              </div>
              <div>
                <div className="font-semibold text-sm">{e.project?.name ?? "—"}</div>
                {e.lamp?.name ? (
                  <div className="text-xs text-muted-foreground">{e.lamp.name}</div>
                ) : null}
                <TaskLampBastidor label={e.task ? getTaskLampElementLabel(e.task) : null} />
              </div>
              {e.process ? (
                <div className="flex items-center gap-1 flex-wrap">
                  <ProcessBadge
                    code={e.process}
                    definition={processByCode.get(e.process)?.badge}
                  />
                  <WorkOrderBadge
                    number={e.task?.workOrder?.number}
                    status={e.task?.workOrder?.status}
                  />
                </div>
              ) : null}
              {e.taskId && canSeeRecords ? (
                <TaskProgressInline
                  progress={computeTaskProgress({
                    isCompleted: maps.completedByTask.get(e.taskId) ?? false,
                    plannedHours: maps.plannedByTask.get(e.taskId) ?? 0,
                    plannedDueHours: maps.plannedDueByTask.get(e.taskId) ?? 0,
                    actualHours: maps.actualByTask.get(e.taskId) ?? 0,
                    hasRunning: entries.some((x) => x.taskId === e.taskId && x.isRunning),
                  })}
                  stripes={maps.plannedItemsByTask.get(e.taskId) ?? []}
                  actions={
                    <TaskProgressActionsPanel
                      taskId={e.taskId}
                      isCompleted={maps.completedByTask.get(e.taskId) ?? false}
                      canManageCompletion={canManageCompletion}
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
                        canCreate: canManageCompletion,
                        canDelete: true,
                      }}
                    />
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </>
    );
  }

  const items = filterTimelineForPerson(fullTimeline, personId).filter(
    (i) => i.kind === "work",
  );

  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin asignaciones</p>
    );
  }

  return (
    <>
      <div className="hidden @3xl/person-week-card:block [&_[data-slot=table-container]]:overflow-x-visible">
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
          {items.map((item) => {
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
                <TableRow
                  key={item.assignment.id}
                  {...withWorkOrderHighlight(item.assignment.task.workOrder?.number)}
                >
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
                    <TaskLampBastidor label={getTaskLampElementLabel(item.assignment.task)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ProcessBadge
                        code={item.assignment.process}
                        definition={processByCode.get(item.assignment.process)?.badge}
                      />
                      <WorkOrderBadge
                        number={item.assignment.task.workOrder?.number}
                        status={item.assignment.task.workOrder?.status}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {formatHours(item.assignment.hours)}
                  </TableCell>
                  <TableCell>
                    {canSeeRecords ? (
                      <TaskProgressInline
                        progress={computeTaskProgress({
                          isCompleted:
                            maps.completedByTask.get(item.assignment.task.id) ?? false,
                          plannedHours: maps.plannedByTask.get(item.assignment.task.id) ?? 0,
                          plannedDueHours:
                            maps.plannedDueByTask.get(item.assignment.task.id) ?? 0,
                          actualHours: maps.actualByTask.get(item.assignment.task.id) ?? 0,
                          hasRunning: actualEntries.some(
                            (x) => x.taskId === item.assignment.task.id && x.isRunning,
                          ),
                        })}
                        stripes={[planStripe]}
                        actions={
                          <TaskProgressActionsPanel
                            taskId={item.assignment.task.id}
                            isCompleted={
                              maps.completedByTask.get(item.assignment.task.id) ?? false
                            }
                            canManageCompletion={canManageCompletion}
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
                              canEdit: canManageCompletion,
                              canCreate: canManageCompletion,
                              canDelete: canManageCompletion,
                            }}
                          />
                        }
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>

    <div className="@3xl/person-week-card:hidden space-y-3 p-3">
      {items.map((item) => {
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
          <div
            key={item.assignment.id}
            className="rounded-lg border bg-card p-3 space-y-2"
            {...withWorkOrderHighlight(item.assignment.task.workOrder?.number)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-mono text-xs">
                <div>{formatShortDate(item.assignment.date)}</div>
                <div className="text-muted-foreground">
                  {rangeLabel(item.assignment.startSlot, item.assignment.endSlot)}
                </div>
              </div>
              <div className="font-mono text-xs font-semibold">
                {formatHours(item.assignment.hours)}
              </div>
            </div>
            <div>
              <div className="font-semibold text-sm">
                {item.assignment.task.project.name}
              </div>
              {item.assignment.task.lamp?.name ? (
                <div className="text-xs text-muted-foreground">
                  {item.assignment.task.lamp.name}
                </div>
              ) : null}
              <TaskLampBastidor label={getTaskLampElementLabel(item.assignment.task)} />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <ProcessBadge
                code={item.assignment.process}
                definition={processByCode.get(item.assignment.process)?.badge}
              />
              <WorkOrderBadge
                number={item.assignment.task.workOrder?.number}
                status={item.assignment.task.workOrder?.status}
              />
            </div>
            {canSeeRecords ? (
              <TaskProgressInline
                progress={computeTaskProgress({
                  isCompleted: maps.completedByTask.get(item.assignment.task.id) ?? false,
                  plannedHours: maps.plannedByTask.get(item.assignment.task.id) ?? 0,
                  plannedDueHours: maps.plannedDueByTask.get(item.assignment.task.id) ?? 0,
                  actualHours: maps.actualByTask.get(item.assignment.task.id) ?? 0,
                  hasRunning: actualEntries.some(
                    (x) => x.taskId === item.assignment.task.id && x.isRunning,
                  ),
                })}
                stripes={[planStripe]}
                actions={
                  <TaskProgressActionsPanel
                    taskId={item.assignment.task.id}
                    isCompleted={maps.completedByTask.get(item.assignment.task.id) ?? false}
                    canManageCompletion={canManageCompletion}
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
                      canEdit: canManageCompletion,
                      canCreate: canManageCompletion,
                      canDelete: canManageCompletion,
                    }}
                  />
                }
              />
            ) : null}
          </div>
        );
      })}
    </div>
    </>
  );
}

export function personWeekListTotalHours(
  view: "plan" | "actual",
  personId: string,
  fullTimeline: PlanningTimelineItem[],
  actualEntries: ActualHourEntry[],
): number {
  if (view === "actual") {
    return actualEntries
      .filter((e) => e.personId === personId)
      .reduce((acc, e) => acc + e.hours, 0);
  }
  return filterTimelineForPerson(fullTimeline, personId)
    .filter((i) => i.kind === "work")
    .reduce((acc, x) => acc + (x.kind === "work" ? x.assignment.hours : 0), 0);
}
