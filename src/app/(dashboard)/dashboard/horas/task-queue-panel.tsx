"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Play, Square, CheckCircle2, ClipboardPenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { completeTask, startTimer, stopTimer } from "@/features/time-tracking/actions";
import { ManualEntryForm } from "./manual-entry-form";

export interface WorkerQueueTask {
  id: string;
  projectId: string;
  projectName: string;
  lampId: string;
  lampName: string;
  process: string;
  order: number;
  plannedRanges: string[];
  plannedDateRanges: { startedAt: string; endedAt: string }[];
  blockedReason: string | null;
}

export interface OpenTimerInfo {
  id: string;
  startedAt: string;
  taskId: string | null;
  projectName: string;
}

function formatHms(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function TaskQueuePanel({
  nextTask,
  queue,
  projects,
  openTimer,
  processLabels = {},
}: {
  nextTask: WorkerQueueTask | null;
  queue: WorkerQueueTask[];
  projects: {
    id: string;
    name: string;
    lamps: { id: string; name: string }[];
    tasks: { id: string; process: string; lampId: string }[];
  }[];
  openTimer: OpenTimerInfo | null;
  processLabels?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(Date.now());
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    if (!openTimer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openTimer]);

  const isTimerOnCurrentTask = Boolean(
    openTimer && nextTask && openTimer.taskId && openTimer.taskId === nextTask.id,
  );
  const isNextTaskBlocked = Boolean(nextTask?.blockedReason);

  const timerText = useMemo(() => {
    if (!openTimer) return null;
    const started = new Date(openTimer.startedAt).getTime();
    return formatHms(now - started);
  }, [now, openTimer]);

  return (
    <div className="space-y-4">
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Siguiente tarea</span>
            {openTimer ? (
              <span className="font-mono text-sm text-muted-foreground">{timerText}</span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!nextTask ? (
            <div className="text-sm text-muted-foreground">No tienes tareas pendientes.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{nextTask.projectName}</div>
                <div className="text-lg font-semibold">{nextTask.lampName}</div>
                <div className="text-sm text-muted-foreground">
                  {processLabels[nextTask.process] ?? nextTask.process} · No completada
                </div>
                {nextTask.blockedReason ? (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    {nextTask.blockedReason}
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  Horario planificado:{" "}
                  {nextTask.plannedRanges.length > 0
                    ? nextTask.plannedRanges.join(" · ")
                    : "Sin franja planificada"}
                </div>
              </div>

              {openTimer && !isTimerOnCurrentTask ? (
                <div className="rounded-md border p-3 text-sm">
                  <div className="font-medium">Tienes un timer activo</div>
                  <div className="text-muted-foreground">
                    Proyecto: {openTimer.projectName}. Para continuar, primero para el contador.
                  </div>
                </div>
              ) : null}

              <div className="grid sm:grid-cols-4 gap-2">
                <Button
                  disabled={pending || !!openTimer || isNextTaskBlocked}
                  className="gap-2"
                  onClick={() => {
                    if (!nextTask) return;
                    startTransition(async () => {
                      try {
                        await startTimer({
                          projectId: nextTask.projectId,
                          lampId: nextTask.lampId,
                          taskId: nextTask.id,
                          process: nextTask.process,
                        });
                        toast.success("Timer iniciado");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Error");
                      }
                    });
                  }}
                >
                  <Play className="size-4" />
                  Iniciar
                </Button>

                <Button
                  variant="destructive"
                  disabled={pending || !openTimer}
                  className="gap-2"
                  onClick={() => {
                    if (!openTimer) return;
                    startTransition(async () => {
                      try {
                        await stopTimer({ entryId: openTimer.id });
                        toast.success("Timer parado");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Error");
                      }
                    });
                  }}
                >
                  <Square className="size-4" />
                  Parar
                </Button>

                <Button
                  variant="secondary"
                  disabled={pending || !nextTask || !!openTimer || isNextTaskBlocked}
                  className={cn("gap-2")}
                  onClick={() => {
                    if (!nextTask) return;
                    startTransition(async () => {
                      try {
                        await completeTask({ taskId: nextTask.id });
                        toast.success("Tarea completada");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Error");
                      }
                    });
                  }}
                >
                  <CheckCircle2 className="size-4" />
                  Completar
                </Button>
                <Button
                  variant="outline"
                  disabled={pending || !nextTask}
                  className="gap-2"
                  onClick={() => setShowManual((v) => !v)}
                >
                  <ClipboardPenLine className="size-4" />
                  Registro manual
                </Button>
              </div>

              {showManual && nextTask ? (
                <div className="rounded-md border p-3">
                  <ManualEntryForm
                    projects={projects}
                    processLabels={processLabels}
                    lockTaskSelection
                    preset={{
                      projectId: nextTask.projectId,
                      lampId: nextTask.lampId,
                      taskId: nextTask.id,
                      process: nextTask.process,
                      ranges: nextTask.plannedDateRanges,
                    }}
                  />
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tareas pendientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {queue.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin tareas pendientes.</div>
          ) : (
            <ul className={cn("space-y-2", queue.length > 5 && "max-h-96 overflow-y-auto pr-1")}>
              {queue.slice(0, 20).map((t, idx) => {
                const isCurrent = nextTask?.id === t.id;
                return (
                  <li
                    key={t.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                      isCurrent && "border-primary",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground truncate">{t.projectName}</div>
                      <div className="font-medium truncate">
                        {idx + 1}. {t.lampName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {processLabels[t.process] ?? t.process}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {t.plannedRanges.length > 0
                          ? t.plannedRanges.join(" · ")
                          : "Sin franja planificada"}
                      </div>
                      {t.blockedReason ? (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 truncate">
                          {t.blockedReason}
                        </div>
                      ) : null}
                    </div>
                    <div className="font-mono text-xs tabular-nums">
                      {t.blockedReason ? "Bloqueada" : "Libre"}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

