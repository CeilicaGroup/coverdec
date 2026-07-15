"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useTransition } from "react";
import { CheckCircle2, Play, Square, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { completeTask, startTimer, stopTimer } from "@/features/time-tracking/actions";
import { formatHours } from "@/lib/format";
import { toast } from "sonner";

export interface WorkerAdHocTask {
  id: string;
  projectId: string;
  projectName: string;
  lampId: string;
  process: string;
  notes: string | null;
  estimatedHours: number;
  isPlanned: boolean;
  plannedRanges: string[];
}

export interface OpenTimerInfo {
  id: string;
  startedAt: string;
  taskId: string | null;
}

export function AdHocTasksPanel({
  tasks,
  openTimer,
  processLabels = {},
}: {
  tasks: WorkerAdHocTask[];
  openTimer: OpenTimerInfo | null;
  processLabels?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();

  if (tasks.length === 0) return null;

  return (
    <Card className="border-dashed border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="size-4 text-amber-600" />
          Imprevistas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.map((task) => {
          const isTimerOnTask = Boolean(
            openTimer?.taskId && openTimer.taskId === task.id,
          );
          const hasOtherTimer = Boolean(openTimer && !isTimerOnTask);

          return (
            <div key={task.id} className="rounded-md border p-3 space-y-2">
              <div>
                <p className="text-sm font-medium line-clamp-2">
                  {task.notes?.trim() || "Imprevista"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {task.projectName} · {processLabels[task.process] ?? task.process} ·{" "}
                  {formatHours(task.estimatedHours)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.isPlanned
                    ? task.plannedRanges.length > 0
                      ? `Planificada: ${task.plannedRanges.join(" · ")}`
                      : "Planificada"
                    : "Pendiente de planificar en calendario"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending || hasOtherTimer}
                  className="gap-1 h-8"
                  onClick={() => {
                    startTransition(async () => {
                      const result = await startTimer({
                        projectId: task.projectId,
                        lampId: task.lampId,
                        taskId: task.id,
                        process: task.process,
                      });
                      const outcome = handleActionResult("ad-hoc.start", result);
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success("Timer iniciado");
                    });
                  }}
                >
                  <Play className="size-3.5" />
                  Iniciar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending || !isTimerOnTask}
                  className="gap-1 h-8"
                  onClick={() => {
                    if (!openTimer) return;
                    startTransition(async () => {
                      const result = await stopTimer({ entryId: openTimer.id });
                      const outcome = handleActionResult("ad-hoc.stop", result);
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success("Timer parado");
                    });
                  }}
                >
                  <Square className="size-3.5" />
                  Parar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || Boolean(openTimer)}
                  className="gap-1 h-8"
                  onClick={() => {
                    startTransition(async () => {
                      const result = await completeTask({ taskId: task.id });
                      const outcome = handleActionResult("ad-hoc.complete", result);
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success("Imprevista completada");
                    });
                  }}
                >
                  <CheckCircle2 className="size-3.5" />
                  Completar
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
