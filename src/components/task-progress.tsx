"use client";

import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/format";
import type { TaskProgress } from "@/features/planning/task-progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

export function TaskProgressInline({
  progress,
  stripes,
  className,
}: {
  progress: TaskProgress;
  stripes: ProgressStripe[];
  className?: string;
}) {
  const text = `${stateLabel(progress)} · ${formatHours(progress.actualHours)}`;
  if (stripes.length === 0) {
    return (
      <span
        className={cn(
          "text-[10px] font-semibold",
          stateClass(progress.state),
          delayedClass(progress.isDelayed),
          className,
        )}
      >
        {text}
      </span>
    );
  }

  const ordered = [...stripes].sort((a, b) => a.label.localeCompare(b.label, "es"));

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "text-[10px] font-semibold cursor-help",
                stateClass(progress.state),
                delayedClass(progress.isDelayed),
                className,
              )}
            >
              {text}
            </span>
          }
        />
        <TooltipContent side="top" className="max-w-sm whitespace-pre-line">
          <ul className="space-y-1">
            {ordered.map((s) => (
              <li key={s.id} className="text-[11px]">
                {s.label}
                {s.isRunning ? <span className="ml-1 text-[10px]">(activo)</span> : null}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

