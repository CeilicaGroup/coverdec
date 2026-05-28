"use client";

import { useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { setPlanningViewModeAction } from "@/features/planning/planning-view-actions";
import type { PlanningViewMode } from "@/features/planning/planning-visibility";

interface PlanningViewToggleProps {
  mode: PlanningViewMode;
}

export function PlanningViewToggle({ mode }: PlanningViewToggleProps) {
  const [pending, startTransition] = useTransition();
  const includeDraft = mode === "include_draft";

  const setMode = (next: PlanningViewMode) => {
    if (next === mode || pending) return;
    startTransition(async () => {
      await setPlanningViewModeAction(next);
    });
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-md border bg-secondary/50 p-0.5 text-[10px] font-semibold",
        pending && "opacity-60 pointer-events-none",
      )}
      role="group"
      aria-label="Vista de planning"
    >
      <button
        type="button"
        onClick={() => setMode("published_only")}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 transition-colors",
          !includeDraft
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <EyeOff className="size-3" />
        Solo publicado
      </button>
      <button
        type="button"
        onClick={() => setMode("include_draft")}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 transition-colors",
          includeDraft
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Eye className="size-3" />
        + borrador
      </button>
    </div>
  );
}
