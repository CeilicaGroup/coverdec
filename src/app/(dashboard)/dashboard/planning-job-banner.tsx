"use client";

import { Loader2 } from "lucide-react";
import { usePlanningJob } from "@/features/planning/use-planning-job-polling";

export function PlanningJobBanner() {
  const { isGenerating, progressLabel, progress } = usePlanningJob();

  if (!isGenerating) return null;

  const weeksGenerated = progress?.weeksGenerated ?? 0;
  const maxWeeks = progress?.maxWeeks ?? 1;
  const progressPct =
    maxWeeks > 0 ? Math.min(100, Math.round((weeksGenerated / maxWeeks) * 100)) : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {progressLabel ?? "Generando planning…"}
          </p>
          <p className="text-xs text-muted-foreground">
            Puedes seguir navegando; el progreso se actualiza automáticamente.
          </p>
        </div>
      </div>

      {maxWeeks > 1 && (
        <div className="space-y-1.5 pl-7">
          <div className="h-1.5 overflow-hidden rounded-full bg-primary/15">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Semanas: {weeksGenerated}/{maxWeeks}
            </span>
            {progress != null && (
              <>
                <span>Asignaciones: {progress.totalAssignments}</span>
                {progress.warningCount > 0 && (
                  <span>Avisos: {progress.warningCount}</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
