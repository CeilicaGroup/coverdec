"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProcessBadgeStyle } from "@/components/process-badge";
import { ProcessBadge } from "@/components/process-badge";
import { PersonAvatar } from "@/components/person-avatar";
import { RiskBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  toPlanningDayIso,
  type GanttLampRow,
  type GanttOperator,
  type GanttProjectRow,
  type GanttTaskRow,
  type GanttTimelineBlock,
} from "@/features/planning/gantt-data";
import {
  resolveBlockRange,
  timelineHoverSummary,
} from "@/features/planning/gantt-timeline";
import { formatDayMonthYear, formatShortDate } from "@/lib/format";
import { toUtcDay } from "@/lib/week";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

export type { GanttProjectRow, GanttLampRow, GanttTaskRow, GanttOperator };

export interface GanttMilestone {
  dateKey: string;
  dayLabel: string;
  lines: string[];
}

interface GanttChartProps {
  axisStartIso: string;
  axisEndIso: string;
  todayIso: string;
  projects: GanttProjectRow[];
  milestones: GanttMilestone[];
  autoExpandProjectId?: string;
  autoExpandLampId?: string;
  processStyles: Record<string, ProcessBadgeStyle>;
}

const WAIT_BAR_COLOR = "rgba(245, 158, 11, 0.55)";
const WAIT_BAR_PATTERN =
  "repeating-linear-gradient(135deg, rgba(245,158,11,0.35) 0, rgba(245,158,11,0.35) 4px, rgba(251,191,36,0.2) 4px, rgba(251,191,36,0.2) 8px)";

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

function dayIndex(keys: string[], iso: string): number {
  return keys.indexOf(iso);
}

function riskColor(risk: GanttProjectRow["risk"]): string {
  if (risk === "RIESGO") return "#B91C1C";
  if (risk === "ATENCION") return "#A16207";
  return "#15803D";
}

function lampKey(projectId: string, lampId: string): string {
  return `${projectId}:${lampId}`;
}

const LABEL_COL = "minmax(220px, 260px)";

function gridCols(axisLen: number): string {
  return `${LABEL_COL} repeat(${axisLen}, minmax(48px, 1fr))`;
}

function GanttOperators({ operators }: { operators: GanttOperator[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {operators.map((op) => (
        <div
          key={op.id}
          className="flex items-center gap-0.5"
          title={op.nombre}
        >
          <PersonAvatar iniciales={op.iniciales} color={op.color} size={16} />
          <span className="text-[10px] text-muted-foreground">{op.iniciales}</span>
        </div>
      ))}
    </div>
  );
}

function GanttPlanningStatus({
  isPlanningComplete,
  isAssigned,
  operators,
}: {
  isPlanningComplete: boolean;
  isAssigned: boolean;
  operators: GanttOperator[];
}) {
  if (isPlanningComplete && !isAssigned) {
    return (
      <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
        Planificado
        {operators.length > 0 ? (
          <span className="ml-1.5 inline-flex align-middle">
            <GanttOperators operators={operators} />
          </span>
        ) : null}
      </span>
    );
  }
  if (!isAssigned) {
    return (
      <span className="text-[10px] text-muted-foreground">Sin asignar</span>
    );
  }
  return <GanttOperators operators={operators} />;
}

function GanttUnassignedTrack() {
  return (
    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-muted-foreground">
      Sin asignar
    </span>
  );
}

function GanttDayGrid({ total }: { total: number }) {
  if (total <= 1) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-full">
      {Array.from({ length: total - 1 }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-border/70"
          style={{ left: `${((i + 1) / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

function GanttBarContent({
  isPlanningComplete,
  isAssigned,
  estimatedStart,
  estimatedEnd,
  timelineBlocks,
  axis,
  total,
  color,
}: {
  isPlanningComplete: boolean;
  isAssigned: boolean;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  timelineBlocks?: GanttTimelineBlock[];
  axis: string[];
  total: number;
  color: string;
}) {
  if (isPlanningComplete && !isAssigned) {
    return (
      <span className="absolute inset-0 z-[1] flex items-center px-2 text-[10px] text-emerald-700/80 dark:text-emerald-400/80">
        Planificado
      </span>
    );
  }
  if (!isAssigned || !estimatedStart || !estimatedEnd) {
    return <GanttUnassignedTrack />;
  }
  if (timelineBlocks && timelineBlocks.length > 0) {
    return (
      <TimelineBars
        blocks={timelineBlocks}
        axis={axis}
        total={total}
        workColor={color}
      />
    );
  }
  return (
    <TimelineBars
      blocks={[
        {
          kind: "work",
          startDayIso: estimatedStart,
          startSlot: 0,
          endDayIso: estimatedEnd,
          endSlot: 8,
          label: `Planificado ${formatShortDate(parseUtc(estimatedStart))} – ${formatShortDate(parseUtc(estimatedEnd))}`,
        },
      ]}
      axis={axis}
      total={total}
      workColor={color}
    />
  );
}

function GanttBarTrack({
  axis,
  total,
  todayIdx,
  showTodayMarker = false,
  children,
}: {
  axis: string[];
  total: number;
  todayIdx: number;
  showTodayMarker?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="relative h-8 mx-2"
      style={{ gridColumn: `2 / span ${axis.length}` }}
    >
      <GanttDayGrid total={total} />
      {showTodayMarker && todayIdx >= 0 ? (
        <div
          className="absolute top-0 bottom-0 w-px bg-primary z-10"
          style={{ left: `${((todayIdx + 0.5) / total) * 100}%` }}
        />
      ) : null}
      <div className="absolute inset-0 bg-secondary/50 rounded-full z-0" />
      <div className="absolute inset-0 z-[1]">{children}</div>
    </div>
  );
}

function ExpandButton({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={label}
    >
      {expanded ? (
        <ChevronDown className="size-3.5" />
      ) : (
        <ChevronRight className="size-3.5" />
      )}
    </Button>
  );
}

function TimelineBars({
  blocks,
  axis,
  total,
  workColor,
}: {
  blocks: GanttTimelineBlock[];
  axis: string[];
  total: number;
  workColor: string;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        const range = resolveBlockRange(axis, block);
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
                    background: isWait ? WAIT_BAR_COLOR : workColor,
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

function DeliveryDiamond({
  deliveryDate,
  axis,
  total,
}: {
  deliveryDate: string;
  axis: string[];
  total: number;
}) {
  const delivIdx = dayIndex(axis, deliveryDate);
  if (delivIdx < 0) return null;

  return (
    <div
      className="absolute top-0 bottom-0 z-20 flex items-center pointer-events-none"
      style={{ left: `${((delivIdx + 1) / total) * 100}%` }}
      title={`Entrega ${formatShortDate(parseUtc(deliveryDate))}`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="absolute text-foreground pointer-events-auto"
        style={{ transform: "translate(-50%, -50%)", top: "50%" }}
      >
        <rect
          x="1.5"
          y="1.5"
          width="7"
          height="7"
          transform="rotate(45 5 5)"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

function ProjectGanttRow({
  project: p,
  axis,
  total,
  todayIdx,
  expanded,
  onToggle,
  hasLamps,
}: {
  project: GanttProjectRow;
  axis: string[];
  total: number;
  todayIdx: number;
  expanded: boolean;
  onToggle: () => void;
  hasLamps: boolean;
}) {
  const color = riskColor(p.risk);
  const isAssigned = p.assignedHours > 0;

  return (
    <div
      className="grid border-t items-center min-h-[44px]"
      style={{ gridTemplateColumns: gridCols(axis.length) }}
    >
      <div className="p-2 space-y-1">
        <div className="flex items-center gap-1">
          {hasLamps ? (
            <ExpandButton
              expanded={expanded}
              onToggle={onToggle}
              label={expanded ? "Ocultar lámparas" : "Ver lámparas"}
            />
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <div className="font-semibold text-xs truncate min-w-0">{p.name}</div>
        </div>
        <div className="flex items-center gap-1 flex-wrap pl-7">
          <RiskBadge level={p.risk} />
          {!isAssigned ? (
            <GanttPlanningStatus
              isPlanningComplete={false}
              isAssigned={false}
              operators={[]}
            />
          ) : null}
        </div>
      </div>
      <GanttBarTrack
        axis={axis}
        total={total}
        todayIdx={todayIdx}
        showTodayMarker
      >
        <GanttBarContent
          isPlanningComplete={false}
          isAssigned={isAssigned}
          estimatedStart={p.estimatedStart}
          estimatedEnd={p.estimatedEnd}
          timelineBlocks={p.timelineBlocks}
          axis={axis}
          total={total}
          color={color}
        />
        {p.deliveryDate ? (
          <DeliveryDiamond
            deliveryDate={p.deliveryDate}
            axis={axis}
            total={total}
          />
        ) : null}
      </GanttBarTrack>
    </div>
  );
}

function LampGanttRow({
  lamp,
  axis,
  total,
  todayIdx,
  expanded,
  onToggle,
}: {
  lamp: GanttLampRow;
  axis: string[];
  total: number;
  todayIdx: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasTasks = lamp.tasks.length > 0;

  return (
    <div
      className="grid border-t items-center min-h-[40px] bg-muted/15"
      style={{ gridTemplateColumns: gridCols(axis.length) }}
    >
      <div className="p-2 pl-6 space-y-1">
        <div className="flex items-center gap-1">
          {hasTasks ? (
            <ExpandButton
              expanded={expanded}
              onToggle={onToggle}
              label={expanded ? "Ocultar procesos" : "Ver procesos"}
            />
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <div className="text-xs font-medium truncate min-w-0">
            {lamp.name ?? "Lámpara sin nombre"}
          </div>
        </div>
        <div className="pl-7">
          <GanttPlanningStatus
            isPlanningComplete={false}
            isAssigned={lamp.isAssigned}
            operators={lamp.operators}
          />
        </div>
      </div>
      <GanttBarTrack axis={axis} total={total} todayIdx={todayIdx}>
        <GanttBarContent
          isPlanningComplete={false}
          isAssigned={lamp.isAssigned}
          estimatedStart={lamp.estimatedStart}
          estimatedEnd={lamp.estimatedEnd}
          timelineBlocks={lamp.timelineBlocks}
          axis={axis}
          total={total}
          color="#64748B"
        />
      </GanttBarTrack>
    </div>
  );
}

function TaskGanttRow({
  task,
  axis,
  total,
  todayIdx,
  processStyles,
}: {
  task: GanttTaskRow;
  axis: string[];
  total: number;
  todayIdx: number;
  processStyles: Record<string, ProcessBadgeStyle>;
}) {
  const processStyle = processStyles[task.process];
  const barColor = processStyle?.borderColor ?? "#6B7280";

  return (
    <div
      className="grid border-t items-center min-h-[36px] bg-muted/25"
      style={{ gridTemplateColumns: gridCols(axis.length) }}
    >
      <div className="p-2 pl-12 space-y-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="flex items-center gap-1 flex-wrap cursor-default">
                <ProcessBadge code={task.process} definition={processStyle} />
              </div>
            }
          />
          <TooltipContent side="right" className="max-w-xs whitespace-pre-line">
            {task.isAssigned && task.timelineBlocks.length > 0
              ? timelineHoverSummary(task.timelineBlocks)
              : "Sin planificación"}
          </TooltipContent>
        </Tooltip>
        <GanttPlanningStatus
          isPlanningComplete={task.isPlanningComplete}
          isAssigned={task.isAssigned}
          operators={task.operators}
        />
      </div>
      <GanttBarTrack axis={axis} total={total} todayIdx={todayIdx}>
        <GanttBarContent
          isPlanningComplete={task.isPlanningComplete}
          isAssigned={task.isAssigned}
          estimatedStart={task.estimatedStart}
          estimatedEnd={task.estimatedEnd}
          timelineBlocks={task.timelineBlocks}
          axis={axis}
          total={total}
          color={barColor}
        />
      </GanttBarTrack>
    </div>
  );
}

export function GanttChart({
  axisStartIso,
  axisEndIso,
  todayIso,
  projects,
  milestones,
  autoExpandProjectId,
  autoExpandLampId,
  processStyles,
}: GanttChartProps) {
  const axis = useMemo(
    () => listBusinessDays(axisStartIso, axisEndIso),
    [axisStartIso, axisEndIso],
  );

  const total = Math.max(1, axis.length);
  const todayIdx = dayIndex(axis, todayIso);

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedLampKeys, setExpandedLampKeys] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (autoExpandProjectId) {
      setExpandedProjectIds((prev) => new Set(prev).add(autoExpandProjectId));
    }
  }, [autoExpandProjectId]);

  useEffect(() => {
    if (autoExpandProjectId && autoExpandLampId) {
      setExpandedLampKeys((prev) =>
        new Set(prev).add(lampKey(autoExpandProjectId, autoExpandLampId)),
      );
    }
  }, [autoExpandProjectId, autoExpandLampId]);

  const toggleProject = (id: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLamp = (projectId: string, lampId: string) => {
    const key = lampKey(projectId, lampId);
    setExpandedLampKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="rounded-lg border overflow-x-auto">
        <div className="min-w-[720px] relative">
          <div
            className="grid border-b bg-muted/40"
            style={{ gridTemplateColumns: gridCols(axis.length) }}
          >
            <div className="p-2 text-xs font-semibold">Proyecto / lámpara / proceso</div>
            {axis.map((iso) => (
              <div
                key={iso}
                className="p-2 text-center text-[10px] text-muted-foreground border-l"
              >
                {formatDayMonthYear(parseUtc(iso))}
              </div>
            ))}
          </div>

          {projects.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Sin proyectos pendientes con los filtros actuales.
            </p>
          ) : (
            projects.map((p) => {
              const projectExpanded = expandedProjectIds.has(p.id);
              const hasLamps = p.lamps.length > 0;

              return (
                <div key={p.id}>
                  <ProjectGanttRow
                    project={p}
                    axis={axis}
                    total={total}
                    todayIdx={todayIdx}
                    expanded={projectExpanded}
                    onToggle={() => toggleProject(p.id)}
                    hasLamps={hasLamps}
                  />
                  {projectExpanded
                    ? p.lamps.map((lamp) => {
                        const key = lampKey(p.id, lamp.id);
                        const lampExpanded = expandedLampKeys.has(key);
                        return (
                          <div key={key}>
                            <LampGanttRow
                              lamp={lamp}
                              axis={axis}
                              total={total}
                              todayIdx={todayIdx}
                              expanded={lampExpanded}
                              onToggle={() => toggleLamp(p.id, lamp.id)}
                            />
                            {lampExpanded
                              ? lamp.tasks.map((task) => (
                                  <TaskGanttRow
                                    key={task.id}
                                    task={task}
                                    axis={axis}
                                    total={total}
                                    todayIdx={todayIdx}
                                    processStyles={processStyles}
                                  />
                                ))
                              : null}
                          </div>
                        );
                      })
                    : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="px-4 py-3 border-b font-semibold text-sm">
          Hitos diarios (planning)
        </div>
        <div className="overflow-x-auto p-3">
          <div className="flex gap-2 min-w-min">
            {milestones.map((m) => (
              <div
                key={m.dateKey}
                className={cn(
                  "rounded-md border p-2 text-[10px] leading-relaxed shrink-0 w-[140px]",
                  m.lines.length === 0 && "opacity-50",
                )}
              >
                <div className="font-bold mb-1">{m.dayLabel}</div>
                {m.lines.length === 0 ? (
                  <span className="text-muted-foreground">Sin asignaciones</span>
                ) : (
                  <ul className="space-y-0.5">
                    {m.lines.slice(0, 8).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                    {m.lines.length > 8 ? (
                      <li className="text-muted-foreground">
                        +{m.lines.length - 8} más
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
