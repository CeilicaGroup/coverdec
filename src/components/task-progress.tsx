"use client";

import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/format";
import type { TaskProgress } from "@/features/planning/task-progress";
import { type ReactNode, useCallback, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TaskProgressTooltipContext } from "@/components/task-progress-tooltip-context";

export interface ProgressStripe {
  id: string;
  label: string;
  kind: "plan" | "actual";
  isRunning?: boolean;
}

function stateClass(state: TaskProgress["state"]): string {
  switch (state) {
    case "completed":
      return "text-emerald-700 dark:text-emerald-400";
    case "in_progress":
      return "text-amber-700 dark:text-amber-400";
    case "not_started":
      return "text-muted-foreground";
  }
}

function delayedClass(isDelayed: boolean): string {
  return isDelayed ? "text-red-700 dark:text-red-400" : "";
}

function stateLabel(p: TaskProgress): string {
  const delayed = p.isDelayed ? " · Retrasada" : "";
  if (p.state === "completed") return "Completada";
  if (p.state === "in_progress") {
    return `${p.hasRunning ? "En progreso (activa)" : "En progreso"}${delayed}`;
  }
  return `No comenzada${delayed}`;
}

function overrunClass(progress: TaskProgress): string {
  if (progress.state !== "completed") return "";
  const diff = progress.actualHours - progress.plannedHours;
  if (progress.plannedHours > 0.01 && diff > 0.01) {
    return "text-red-700 dark:text-red-400";
  }
  if (progress.plannedHours > 0.01 && diff < -0.01) {
    return "text-sky-700 dark:text-sky-400";
  }
  return "";
}

export function stripeKindLabel(kind: ProgressStripe["kind"]): string {
  return kind === "actual" ? "Registro" : "Plan";
}

export function stripeKindClass(kind: ProgressStripe["kind"]): string {
  return kind === "actual"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
    : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300";
}

export function ProgressStripeKindBadge({
  kind,
  isRunning,
}: {
  kind: ProgressStripe["kind"];
  isRunning?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
          stripeKindClass(kind),
        )}
      >
        {stripeKindLabel(kind)}
      </span>
      {isRunning ? (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          Activo
        </span>
      ) : null}
    </div>
  );
}

export function TaskProgressInline({
  progress,
  stripes,
  className,
  actions,
}: {
  progress: TaskProgress;
  stripes: ProgressStripe[];
  className?: string;
  actions?: ReactNode;
}) {
  const diff = progress.actualHours - progress.plannedHours;
  const showDiff =
    progress.state === "completed"
      ? progress.plannedHours > 0.01
      : progress.state === "in_progress"
        ? progress.actualHours > progress.plannedDueHours + 0.01
        : false;
  const diffText = showDiff
    ? ` · ${diff >= 0 ? "+" : ""}${formatHours(diff)}`
    : "";
  const text = `${stateLabel(progress)} · ${formatHours(progress.actualHours)}${diffText}`;
  const deduped = Array.from(
    new Map(stripes.map((s) => [`${s.kind}|${s.label}|${Boolean(s.isRunning)}`, s])).values(),
  );
  const ordered = deduped.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "actual" ? -1 : 1;
    return a.label.localeCompare(b.label, "es");
  });

  const [hoverOpen, setHoverOpen] = useState(false);
  const [clickOpen, setClickOpen] = useState(false);
  const [dialogPinned, setDialogPinned] = useState(false);
  const tooltipOpen = hoverOpen || clickOpen || dialogPinned;

  const pinTooltip = useCallback(() => setDialogPinned(true), []);
  const unpinTooltip = useCallback(() => setDialogPinned(false), []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (dialogPinned && !next) return;
      if (!next) setClickOpen(false);
      setHoverOpen(next);
    },
    [dialogPinned],
  );

  const handleTriggerClick = useCallback(() => {
    setClickOpen((open) => !open);
  }, []);

  return (
    <TaskProgressTooltipContext.Provider value={{ pinTooltip, unpinTooltip }}>
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={handleOpenChange} disableHoverablePopup={false}>
        <TooltipTrigger
          closeOnClick={false}
          delay={0}
          render={
            <span
              className={cn(
                "text-[10px] font-semibold cursor-pointer",
                stateClass(progress.state),
                delayedClass(progress.isDelayed),
                overrunClass(progress),
                className,
              )}
              onClick={handleTriggerClick}
            >
              {text}
            </span>
          }
        />
        <TooltipContent side="top" className="min-w-[300px] max-w-lg border bg-popover/95 p-3">
          {ordered.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Sin franjas de referencia.</div>
          ) : (
            <ul className="space-y-1.5">
              {ordered.map((s) => (
                <li key={s.id} className="rounded-md border px-2 py-1">
                  <ProgressStripeKindBadge kind={s.kind} isRunning={s.isRunning} />
                  <div className="mt-1 text-[11px]">{s.label}</div>
                </li>
              ))}
            </ul>
          )}
          {actions ? (
            <div
              className="mt-2 space-y-2 border-t pt-2"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    </TaskProgressTooltipContext.Provider>
  );
}

