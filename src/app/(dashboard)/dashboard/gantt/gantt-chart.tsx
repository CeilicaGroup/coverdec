"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProcessBadgeStyle } from "@/components/process-badge";
import { ProcessBadge } from "@/components/process-badge";
import { PersonAvatar } from "@/components/person-avatar";
import { RiskBadge } from "@/components/risk-badge";
import { WeekProgressBar } from "@/components/week-progress-bar";
import { Button } from "@/components/ui/button";
import {
  toPlanningDayIso,
  type GanttLampRow,
  type GanttOperator,
  type GanttProjectRow,
  type GanttTaskRow,
} from "@/features/planning/gantt-data";
import { formatDayMonthYear, formatHours, formatShortDate } from "@/lib/format";
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
  weekStartIso: string;
  horizonEndIso: string;
  todayIso: string;
  projects: GanttProjectRow[];
  milestones: GanttMilestone[];
  autoExpandProjectId?: string;
  autoExpandLampId?: string;
  processStyles: Record<string, ProcessBadgeStyle>;
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

function dayIndex(keys: string[], iso: string): number {
  return keys.indexOf(iso);
}

function firstAxisOnOrAfter(axis: string[], ms: number): number {
  for (let i = 0; i < axis.length; i++) {
    if (parseUtc(axis[i]!).getTime() >= ms) return i;
  }
  return axis.length - 1;
}

function lastAxisOnOrBefore(axis: string[], ms: number): number {
  for (let i = axis.length - 1; i >= 0; i--) {
    if (parseUtc(axis[i]!).getTime() <= ms) return i;
  }
  return 0;
}

function resolveBarIndices(
  axis: string[],
  estimatedStart: string,
  estimatedEnd: string,
): { startIdx: number; endIdx: number } | null {
  if (!estimatedStart || !estimatedEnd || axis.length === 0) return null;

  const startMs = parseUtc(estimatedStart).getTime();
  const endMs = parseUtc(estimatedEnd).getTime();
  const axisStartMs = parseUtc(axis[0]!).getTime();
  const axisEndMs = parseUtc(axis[axis.length - 1]!).getTime();

  if (endMs < axisStartMs || startMs > axisEndMs) return null;

  let startIdx = dayIndex(axis, estimatedStart);
  let endIdx = dayIndex(axis, estimatedEnd);

  if (startIdx < 0) {
    startIdx = startMs < axisStartMs ? 0 : firstAxisOnOrAfter(axis, startMs);
  }
  if (endIdx < 0) {
    endIdx = endMs > axisEndMs ? axis.length - 1 : lastAxisOnOrBefore(axis, endMs);
  }

  return {
    startIdx: Math.min(startIdx, endIdx),
    endIdx: Math.max(startIdx, endIdx),
  };
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

function GanttWeekHoursLine({
  weekScopeHours,
  pendingHours,
}: {
  weekScopeHours: number;
  pendingHours: number;
}) {
  return (
    <span className="text-[10px] text-muted-foreground font-mono">
      {formatHours(weekScopeHours)} est. sem. · {formatHours(pendingHours)} pend.
    </span>
  );
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
        Terminado (sem. ant.)
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

function GanttBarContent({
  isPlanningComplete,
  isAssigned,
  estimatedStart,
  estimatedEnd,
  axis,
  total,
  color,
  title,
}: {
  isPlanningComplete: boolean;
  isAssigned: boolean;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  axis: string[];
  total: number;
  color: string;
  title?: string;
}) {
  if (isPlanningComplete && !isAssigned) {
    return (
      <span className="absolute inset-0 flex items-center px-2 text-[10px] text-emerald-700/80 dark:text-emerald-400/80">
        Terminado
      </span>
    );
  }
  if (!isAssigned || !estimatedStart || !estimatedEnd) {
    return <GanttUnassignedTrack />;
  }
  return (
    <PlannedBar
      estimatedStart={estimatedStart}
      estimatedEnd={estimatedEnd}
      axis={axis}
      total={total}
      color={color}
      title={title}
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
      {showTodayMarker && todayIdx >= 0 ? (
        <div
          className="absolute top-0 bottom-0 w-px bg-primary z-10"
          style={{ left: `${((todayIdx + 0.5) / total) * 100}%` }}
        />
      ) : null}
      <div className="absolute inset-0 bg-secondary/50 rounded-full" />
      {children}
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

function PlannedBar({
  estimatedStart,
  estimatedEnd,
  axis,
  total,
  color,
  title,
}: {
  estimatedStart: string;
  estimatedEnd: string;
  axis: string[];
  total: number;
  color: string;
  title?: string;
}) {
  const resolved = resolveBarIndices(axis, estimatedStart, estimatedEnd);
  if (!resolved) return null;

  const { startIdx, endIdx } = resolved;
  const barLeft = (startIdx / total) * 100;
  const barWidth = ((endIdx - startIdx + 1) / total) * 100;

  return (
    <div
      className="absolute top-1.5 bottom-1.5 rounded-full opacity-90"
      style={{
        left: `${barLeft}%`,
        width: `${Math.max(2, barWidth)}%`,
        background: color,
      }}
      title={title}
    />
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
  const delivIdx = p.deliveryDate ? dayIndex(axis, p.deliveryDate) : -1;
  const color = riskColor(p.risk);
  const isAssigned = p.assignedHoursWeek > 0;
  const rangeTitle =
    isAssigned && p.estimatedStart && p.estimatedEnd
      ? `Planificado ${formatShortDate(parseUtc(p.estimatedStart))} – ${formatShortDate(parseUtc(p.estimatedEnd))}`
      : undefined;

  return (
    <div
      className="grid border-t items-center min-h-[52px]"
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
          <WeekProgressBar
            basePct={p.progress.progressBasePct}
            endPct={p.progress.progressEndPct}
          />
          <GanttWeekHoursLine
            weekScopeHours={p.weekScopeHours}
            pendingHours={
              p.weekScopeHours - p.assignedHoursWeek > 0
                ? p.weekScopeHours - p.assignedHoursWeek
                : 0
            }
          />
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
        showTodayMarker={!expanded}
      >
        {!expanded ? (
          <GanttBarContent
            isPlanningComplete={false}
            isAssigned={isAssigned}
            estimatedStart={p.estimatedStart}
            estimatedEnd={p.estimatedEnd}
            axis={axis}
            total={total}
            color={color}
            title={rangeTitle}
          />
        ) : null}
        {!expanded && delivIdx >= 0 && p.deliveryDate ? (
          <div
            className="absolute top-0 bottom-0 z-20 flex items-center"
            style={{ left: `${((delivIdx + 1) / total) * 100}%` }}
            title={`Entrega ${formatShortDate(parseUtc(p.deliveryDate))}`}
          >
            <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/80" />
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="absolute text-foreground"
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
  const rangeTitle =
    lamp.isAssigned && lamp.estimatedStart && lamp.estimatedEnd
      ? `Planificado ${formatShortDate(parseUtc(lamp.estimatedStart))} – ${formatShortDate(parseUtc(lamp.estimatedEnd))}`
      : undefined;

  return (
    <div
      className="grid border-t items-center min-h-[44px] bg-muted/15"
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
        <div className="space-y-0.5 pl-7">
          <WeekProgressBar
            basePct={lamp.progress.progressBasePct}
            endPct={lamp.progress.progressEndPct}
          />
          <GanttWeekHoursLine
            weekScopeHours={lamp.weekScopeHours}
            pendingHours={lamp.tasks.reduce((a, t) => a + t.pendingHours, 0)}
          />
          <GanttPlanningStatus
            isPlanningComplete={false}
            isAssigned={lamp.isAssigned}
            operators={lamp.operators}
          />
        </div>
      </div>
      <GanttBarTrack axis={axis} total={total} todayIdx={todayIdx}>
        {!expanded ? (
          <GanttBarContent
            isPlanningComplete={false}
            isAssigned={lamp.isAssigned}
            estimatedStart={lamp.estimatedStart}
            estimatedEnd={lamp.estimatedEnd}
            axis={axis}
            total={total}
            color="#64748B"
            title={rangeTitle}
          />
        ) : null}
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
  const rangeTitle =
    task.isAssigned && task.estimatedStart && task.estimatedEnd
      ? `Planificado ${formatShortDate(parseUtc(task.estimatedStart))} – ${formatShortDate(parseUtc(task.estimatedEnd))}`
      : undefined;

  return (
    <div
      className="grid border-t items-center min-h-[40px] bg-muted/25"
      style={{ gridTemplateColumns: gridCols(axis.length) }}
    >
      <div className="p-2 pl-12 space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <ProcessBadge code={task.process} definition={processStyle} />
        </div>
        <WeekProgressBar
          basePct={task.progress.progressBasePct}
          endPct={task.progress.progressEndPct}
        />
        <GanttWeekHoursLine
          weekScopeHours={task.weekScopeHours}
          pendingHours={task.pendingHours}
        />
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
          axis={axis}
          total={total}
          color={barColor}
          title={rangeTitle}
        />
      </GanttBarTrack>
    </div>
  );
}

export function GanttChart({
  weekStartIso,
  horizonEndIso,
  todayIso,
  projects,
  milestones,
  autoExpandProjectId,
  autoExpandLampId,
  processStyles,
}: GanttChartProps) {
  const axis = useMemo(
    () => listBusinessDays(weekStartIso, horizonEndIso),
    [weekStartIso, horizonEndIso],
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
        <div className="px-4 py-3 border-b font-semibold text-sm">Hitos diarios (planning)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-3">
          {milestones.map((m) => (
            <div
              key={m.dateKey}
              className={cn(
                "rounded-md border p-2 text-[10px] leading-relaxed",
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
                    <li className="text-muted-foreground">+{m.lines.length - 8} más</li>
                  ) : null}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
