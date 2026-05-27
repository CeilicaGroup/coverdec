"use client";

import { useMemo } from "react";
import { PersonAvatar } from "@/components/person-avatar";
import type { ProcessBadgeStyle } from "@/components/process-badge";
import { ProcessBadge } from "@/components/process-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { GanttTimelineBlock } from "@/features/planning/gantt-data";
import { toPlanningDayIso } from "@/features/planning/gantt-data";
import {
  buildGanttTimeAxisContext,
  daySpanMinutes,
  type GanttTimeAxisContext,
  type WorkWindowRow,
} from "@/features/planning/gantt-time-axis";
import { resolveBlockRange, timelineHoverSummary } from "@/features/planning/gantt-timeline";
import { formatDayMonthYear } from "@/lib/format";
import { toUtcDay } from "@/lib/week";
import { cn } from "@/lib/utils";
import { computeTaskProgress } from "@/features/planning/task-progress";
import { TaskProgressInline, type ProgressStripe } from "@/components/task-progress";

const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_COL = "minmax(220px, 260px)";
const WAIT_BAR_COLOR = "rgba(245, 158, 11, 0.55)";
const WAIT_BAR_PATTERN =
  "repeating-linear-gradient(135deg, rgba(245,158,11,0.35) 0, rgba(245,158,11,0.35) 4px, rgba(251,191,36,0.2) 4px, rgba(251,191,36,0.2) 8px)";

export interface GanttWorkerTaskRow {
  id: string;
  label: string;
  process: string;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  isAssigned: boolean;
  timelineBlocks: GanttTimelineBlock[];
}

export interface GanttWorkerRow {
  id: string;
  iniciales: string;
  nombre: string;
  color: string;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  isAssigned: boolean;
  timelineBlocks: GanttTimelineBlock[];
  tasks: GanttWorkerTaskRow[];
}

function parseUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function listBusinessDays(startIso: string, endIso: string): string[] {
  const keys: string[] = [];
  let cursor = toUtcDay(parseUtc(startIso));
  const end = toUtcDay(parseUtc(endIso));
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) {
      keys.push(toPlanningDayIso(cursor));
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return keys;
}

function gridCols(axisLen: number): string {
  return `${LABEL_COL} repeat(${axisLen}, minmax(48px, 1fr))`;
}

function formatMinutesClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function GanttDayGrid({
  dayIso,
  timeAxis,
}: {
  dayIso: string;
  timeAxis: GanttTimeAxisContext;
}) {
  const bounds = timeAxis.boundsForDayIso(dayIso);
  const hourCount = Math.floor(daySpanMinutes(bounds) / 60);
  if (hourCount <= 0) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-full">
      {Array.from({ length: hourCount }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-border/70"
          style={{ left: `${((i + 1) / (hourCount + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}

function TimelineBars({
  blocks,
  axis,
  total,
  color,
  timeAxis,
}: {
  blocks: GanttTimelineBlock[];
  axis: string[];
  total: number;
  color: string;
  timeAxis: GanttTimeAxisContext;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        const range = resolveBlockRange(axis, block, timeAxis);
        if (!range) return null;
        const barLeft = (range.startFrac / total) * 100;
        const barWidth = ((range.endFrac - range.startFrac) / total) * 100;
        const isWait = block.kind === "wait";

        return (
          <Tooltip key={`${block.kind}-${block.startDayIso}-${block.startSlot}-${i}`}>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    "absolute top-1.5 bottom-1.5 rounded-sm opacity-90 cursor-default",
                    isWait && "opacity-100",
                  )}
                  style={{
                    left: `${barLeft}%`,
                    width: `${barWidth}%`,
                    background: isWait ? WAIT_BAR_COLOR : color,
                    backgroundImage: isWait ? WAIT_BAR_PATTERN : undefined,
                  }}
                />
              }
            />
            <TooltipContent side="top" className="max-w-xs whitespace-pre-line">
              {block.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}

export function GanttWorkerChart({
  axisStartIso,
  axisEndIso,
  workWindows,
  workers,
  processStyles,
  mode,
  plannedItemsByTask,
  actualItemsByTask,
}: {
  axisStartIso: string;
  axisEndIso: string;
  workWindows: WorkWindowRow[];
  workers: GanttWorkerRow[];
  processStyles: Record<string, ProcessBadgeStyle>;
  mode: "plan" | "actual";
  plannedItemsByTask: Map<string, ProgressStripe[]>;
  actualItemsByTask: Map<string, ProgressStripe[]>;
}) {
  const timeAxis = useMemo(
    () => buildGanttTimeAxisContext(workWindows),
    [workWindows],
  );

  const axis = useMemo(
    () => listBusinessDays(axisStartIso, axisEndIso),
    [axisStartIso, axisEndIso],
  );
  const total = Math.max(1, axis.length);

  return (
    <TooltipProvider>
      <div className="rounded-lg border overflow-x-auto">
        <div className="min-w-[720px] relative">
          <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: gridCols(axis.length) }}>
            <div className="p-2 text-xs font-semibold">Trabajador / tarea</div>
            {axis.map((iso) => {
              const bounds = timeAxis.boundsForDayIso(iso);
              return (
                <div
                  key={iso}
                  className="p-2 text-center text-[10px] text-muted-foreground border-l"
                  title={`${formatMinutesClock(bounds.dayStartMinutes)} – ${formatMinutesClock(bounds.dayEndMinutes)}`}
                >
                  <div>{formatDayMonthYear(parseUtc(iso))}</div>
                  <div className="text-[9px] opacity-80">
                    {formatMinutesClock(bounds.dayStartMinutes)}–
                    {formatMinutesClock(bounds.dayEndMinutes)}
                  </div>
                </div>
              );
            })}
          </div>

          {workers.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Sin tareas pendientes con los filtros actuales.</p>
          ) : (
            workers.map((worker) => (
              <div key={worker.id}>
                <div className="grid border-t items-center min-h-[44px]" style={{ gridTemplateColumns: gridCols(axis.length) }}>
                  <div className="p-2 flex items-center gap-2">
                    <PersonAvatar iniciales={worker.iniciales} color={worker.color} size={18} />
                    <div className="text-xs font-semibold truncate">{worker.iniciales} · {worker.nombre}</div>
                  </div>
                  <div className="relative h-8 mx-2" style={{ gridColumn: `2 / span ${axis.length}` }}>
                    <GanttDayGrid
                      dayIso={worker.estimatedStart ?? axis[0] ?? ""}
                      timeAxis={timeAxis}
                    />
                    <div className="absolute inset-0 bg-secondary/50 rounded-full z-0" />
                    <div className="absolute inset-0 z-[1]">
                      {worker.isAssigned ? (
                        <TimelineBars
                          blocks={worker.timelineBlocks}
                          axis={axis}
                          total={total}
                          color={worker.color}
                          timeAxis={timeAxis}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] text-muted-foreground">Sin asignar</span>
                      )}
                    </div>
                  </div>
                </div>

                {worker.tasks.map((task) => {
                  const processStyle = processStyles[task.process];
                  const barColor = processStyle?.borderColor ?? "#6B7280";
                  return (
                    <div key={task.id} className="grid border-t items-center min-h-[36px] bg-muted/25" style={{ gridTemplateColumns: gridCols(axis.length) }}>
                      <div className="p-2 pl-10 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ProcessBadge code={task.process} definition={processStyle} />
                          <span className="text-[10px] text-muted-foreground truncate">{task.label}</span>
                        </div>
                        <Tooltip>
                          <TooltipTrigger render={<span className="text-[10px] text-muted-foreground cursor-default">Detalle</span>} />
                          <TooltipContent side="right" className="max-w-xs whitespace-pre-line">
                            {task.timelineBlocks.length > 0 ? timelineHoverSummary(task.timelineBlocks) : "Sin planificación"}
                          </TooltipContent>
                        </Tooltip>
                        {(() => {
                          const taskId = task.id.split(":")[1];
                          return (
                            <TaskProgressInline
                              progress={computeTaskProgress({
                                isCompleted: false,
                                plannedHours: 0,
                                actualHours: 0,
                                hasRunning: (actualItemsByTask.get(taskId) ?? []).some((s) => s.isRunning),
                              })}
                              stripes={[
                                ...(plannedItemsByTask.get(taskId) ?? []),
                                ...(actualItemsByTask.get(taskId) ?? []),
                              ]}
                            />
                          );
                        })()}
                      </div>
                      <div className="relative h-8 mx-2" style={{ gridColumn: `2 / span ${axis.length}` }}>
                        <GanttDayGrid
                          dayIso={task.estimatedStart ?? axis[0] ?? ""}
                          timeAxis={timeAxis}
                        />
                        <div className="absolute inset-0 bg-secondary/50 rounded-full z-0" />
                        <div className="absolute inset-0 z-[1]">
                          {task.isAssigned && task.estimatedStart && task.estimatedEnd ? (
                            <TimelineBars
                              blocks={task.timelineBlocks}
                              axis={axis}
                              total={total}
                              color={barColor}
                              timeAxis={timeAxis}
                            />
                          ) : (
                            <span className="absolute inset-0 flex items-center px-2 text-[10px] text-muted-foreground">Sin asignar</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
