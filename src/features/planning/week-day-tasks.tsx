import {
  ProcessBadge,
  processColor,
  type ProcessBadgeStyle,
} from "@/components/process-badge";
import { WorkOrderBadge } from "@/components/work-order-badge";
import { LampElementVisual } from "@/components/lamp-element-visual";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";
import { rangeLabel, slotEndToHour, slotToHour } from "@/features/planning/engine/slot-format";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { TaskProgressActionsPanel } from "@/features/time-tracking/task-progress-actions-panel";
import { toIsoUtcFromDateAndHour } from "@/lib/datetime-local";
import { formatHours } from "@/lib/format";
import { withWorkOrderHighlight } from "@/features/work-orders/highlight";
import { AdHocTaskNotesIcon, AdHocTaskNotesTooltip } from "@/features/planning/ad-hoc-task-notes";
import { DeleteAdHocTaskButton } from "@/features/ad-hoc/delete-ad-hoc-task-button";
import type { WeekGridCell } from "./week-person-grid";
import type { buildEntriesByPersonDayTask } from "./week-person-grid";

interface WeekDayTasksProps {
  personId: string;
  dayKey: string;
  tasks: WeekGridCell[];
  view: "plan" | "actual";
  isAbsent: boolean;
  plannedHoursByTask: Map<string, number>;
  plannedDueHoursByTask: Map<string, number>;
  actualHoursByTask: Map<string, number>;
  plannedItemsByTask: Map<string, { id: string; label: string }[]>;
  actualRunningByTask: Map<string, boolean>;
  completedByTask: Map<string, boolean>;
  processStyles: Map<string, ProcessBadgeStyle>;
  canEditEntries: boolean;
  canSeeRecords: boolean;
  canManageAdHoc?: boolean;
  entriesByPersonDayTask: ReturnType<typeof buildEntriesByPersonDayTask>;
  typologyImages?: TypologyImageAvailability;
  elementTypeImages?: ElementTypeImageAvailability;
  emptyClassName?: string;
}

export function WeekDayTasks({
  personId,
  dayKey,
  tasks,
  view,
  isAbsent,
  plannedHoursByTask,
  plannedDueHoursByTask,
  actualHoursByTask,
  plannedItemsByTask,
  actualRunningByTask,
  completedByTask,
  processStyles,
  canEditEntries,
  canSeeRecords,
  canManageAdHoc = false,
  entriesByPersonDayTask,
  typologyImages,
  elementTypeImages,
  emptyClassName = "text-[10px]",
}: WeekDayTasksProps) {
  function entriesForTaskOnDay(taskId: string): ReturnType<typeof entriesByPersonDayTask.get> {
    const exact = entriesByPersonDayTask.get(`${personId}|${dayKey}|${taskId}`) ?? [];
    if (exact.length > 0 || view !== "plan") return exact;

    const taskEntriesAcrossWeek = [...entriesByPersonDayTask.entries()]
      .filter(([key]) => key.startsWith(`${personId}|`) && key.endsWith(`|${taskId}`))
      .flatMap(([, value]) => value)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );

    return taskEntriesAcrossWeek;
  }

  if (isAbsent) {
    return (
      <div className={`rounded bg-muted px-2 py-1 ${emptyClassName} text-muted-foreground text-center`}>
        Ausencia
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div
        className={`rounded border border-dashed px-2 py-1 ${emptyClassName} text-muted-foreground text-center`}
      >
        Libre
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const colors = processColor(t.process, processStyles.get(t.process));
        const planned = t.taskId ? (plannedHoursByTask.get(t.taskId) ?? 0) : 0;
        const plannedDue = t.taskId ? (plannedDueHoursByTask.get(t.taskId) ?? 0) : 0;
        const actual = t.taskId ? (actualHoursByTask.get(t.taskId) ?? 0) : 0;
        const stripes: ProgressStripe[] =
          t.taskId
            ? view === "actual"
              ? (plannedItemsByTask.get(t.taskId) ?? []).map((x) => ({
                  id: `plan-${x.id}`,
                  label: x.label,
                  kind: "plan" as const,
                }))
              : t.startSlot != null && t.endSlot != null
                ? [
                    {
                      id: `plan-${t.id}`,
                      label: `${dayKey} · ${rangeLabel(t.startSlot, t.endSlot)} · ${formatHours(t.hours)} · ${t.process}`,
                      kind: "plan" as const,
                    },
                  ]
                : []
            : [];
        const hasRunning = t.taskId ? (actualRunningByTask.get(t.taskId) ?? false) : false;
        const dayDate = new Date(`${dayKey}T00:00:00Z`);
        const planStartedAt =
          t.startSlot != null
            ? toIsoUtcFromDateAndHour(dayDate, slotToHour(t.startSlot))
            : `${dayKey}T08:00:00.000Z`;
        const planEndedAt =
          t.endSlot != null
            ? toIsoUtcFromDateAndHour(dayDate, slotEndToHour(t.endSlot))
            : `${dayKey}T09:00:00.000Z`;
        const startedAt = view === "actual" && t.startedAt ? t.startedAt : planStartedAt;
        const endedAt = view === "actual" && t.endedAt ? t.endedAt : planEndedAt;
        const cellEntries =
          t.taskId != null
            ? (entriesForTaskOnDay(t.taskId) ?? [])
            : [];

        const woHighlight = withWorkOrderHighlight(
          t.workOrderNumber,
          "rounded px-2 py-1.5 border-l-[3px] text-xs leading-tight",
        );

        return (
          <div key={t.id} className="relative">
            {canManageAdHoc && t.isAdHoc && view === "plan" && t.taskId ? (
              <div className="absolute top-0 right-0 z-10">
                <DeleteAdHocTaskButton
                  taskId={t.taskId}
                  notes={t.notes}
                  hasTimeEntries={(actualHoursByTask.get(t.taskId) ?? 0) > 0}
                />
              </div>
            ) : null}
            <AdHocTaskNotesTooltip notes={t.notes}>
              <div
                {...woHighlight}
                style={{
                  background: colors.bgColor,
                  borderColor: colors.borderColor,
                }}
              >
            {(t.timeLabel ??
              (t.startSlot !== null && t.endSlot !== null
                ? rangeLabel(t.startSlot, t.endSlot)
                : null)) && (
              <div className="font-mono text-[10px] opacity-70">
                {t.timeLabel ?? rangeLabel(t.startSlot!, t.endSlot!)}
              </div>
            )}
            <div className="font-semibold truncate" style={{ color: colors.fgColor }}>
              {t.project}
            </div>
            {t.lamp ? (
              <div className="text-[10px] truncate opacity-80" style={{ color: colors.fgColor }}>
                {t.lamp}
              </div>
            ) : null}
            <LampElementVisual
              label={t.bastidor}
              typology={t.elementTypology ?? undefined}
              typologyImages={typologyImages}
              elementTypeId={t.elementTypeId}
              elementTypeImages={elementTypeImages}
              size="sm"
              compact
              className="text-[10px] opacity-80"
            />
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              <ProcessBadge code={t.process} definition={processStyles.get(t.process)} />
              <AdHocTaskNotesIcon notes={t.notes} />
              <WorkOrderBadge number={t.workOrderNumber} status={t.workOrderStatus ?? undefined} />
              <span
                className="font-mono text-[10px] font-bold ml-auto"
                style={{ color: colors.fgColor }}
              >
                {formatHours(t.hours)}
              </span>
            </div>
            {t.taskId && canSeeRecords ? (
              <TaskProgressInline
                progress={computeTaskProgress({
                  isCompleted: completedByTask.get(t.taskId) ?? false,
                  plannedHours: planned,
                  plannedDueHours: plannedDue,
                  actualHours: actual,
                  hasRunning,
                })}
                stripes={stripes}
                className="mt-1 block"
                actions={
                  canEditEntries ? (
                    <TaskProgressActionsPanel
                      taskId={t.taskId}
                      isCompleted={completedByTask.get(t.taskId) ?? false}
                      canManageCompletion={canEditEntries}
                      timeEntry={{
                        entries: cellEntries,
                        userId: t.userId ?? undefined,
                        personId: t.personId ?? personId,
                        projectId: t.projectId ?? "",
                        lampId: t.lampId ?? undefined,
                        taskId: t.taskId,
                        process: t.process,
                        startedAt,
                        endedAt,
                        defaultStartedAt: planStartedAt,
                        defaultEndedAt: planEndedAt,
                        notes: t.notes,
                        canEdit: canEditEntries,
                        canCreate: canEditEntries,
                        canDelete: canEditEntries,
                      }}
                    />
                  ) : null
                }
              />
            ) : null}
              </div>
            </AdHocTaskNotesTooltip>
          </div>
        );
      })}
    </div>
  );
}
