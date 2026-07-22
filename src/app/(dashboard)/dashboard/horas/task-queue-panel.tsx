"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Play, Square, CheckCircle2, ClipboardPenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkOrderBadge } from "@/components/work-order-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { withWorkOrderHighlight } from "@/features/work-orders/highlight";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  completeTask,
  recordAndCompleteGroupedOtTasks,
  startTimer,
  stopTimer,
} from "@/features/time-tracking/actions";
import { ManualEntryForm } from "./manual-entry-form";

export interface ManualBreakScheduleSnapshot {
  weekly: {
    dayOfWeek: number;
    windows: { startMinutes: number; endMinutes: number }[];
  }[];
  overrides: {
    dateIso: string;
    windows: { startMinutes: number; endMinutes: number }[];
  }[];
}

export interface WorkerQueueTask {
  id: string;
  projectId: string;
  projectName: string;
  lampId: string;
  lampName: string;
  elementLabel: string;
  measureLabel: string;
  process: string;
  order: number;
  plannedRanges: string[];
  plannedDateRanges: { startedAt: string; endedAt: string }[];
  blockedReason: string | null;
  workOrderId: string | null;
  groupKey: string | null;
  groupPendingCount: number;
  workOrderNumber: string | null;
  workOrderStatus: import("@/generated/prisma").WorkOrderStatus | null;
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

function resolveActiveTask(
  queue: WorkerQueueTask[],
  nextTask: WorkerQueueTask | null,
  selectedTaskId: string | null,
  openTimer: OpenTimerInfo | null,
): WorkerQueueTask | null {
  if (openTimer?.taskId) {
    const timerTask = queue.find((t) => t.id === openTimer.taskId);
    if (timerTask) return timerTask;
  }
  if (selectedTaskId) {
    const selected = queue.find((t) => t.id === selectedTaskId);
    if (selected && !selected.blockedReason) return selected;
  }
  return nextTask;
}

export function TaskQueuePanel({
  nextTask,
  queue,
  projects,
  manualBreakSchedule,
  openTimer,
  processLabels = {},
}: {
  nextTask: WorkerQueueTask | null;
  queue: WorkerQueueTask[];
  projects: {
    id: string;
    name: string;
    lamps: { id: string; name: string }[];
    tasks: {
      id: string;
      process: string;
      lampId: string;
      workOrderId: string | null;
      groupKey: string | null;
      groupPendingCount: number;
      elementLabel: string;
      measureLabel: string;
    }[];
  }[];
  manualBreakSchedule: ManualBreakScheduleSnapshot | null;
  openTimer: OpenTimerInfo | null;
  processLabels?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(Date.now());
  const [showManual, setShowManual] = useState(false);
  const [showGroupedDialog, setShowGroupedDialog] = useState(false);
  const [groupedQuantity, setGroupedQuantity] = useState("1");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const activeTask = useMemo(
    () => resolveActiveTask(queue, nextTask, selectedTaskId, openTimer),
    [queue, nextTask, selectedTaskId, openTimer],
  );

  const recommendedTaskIndex = useMemo(() => {
    if (!nextTask) return null;
    const idx = queue.findIndex((t) => t.id === nextTask.id);
    return idx >= 0 ? idx + 1 : null;
  }, [queue, nextTask]);

  const showsRecommendedHint = Boolean(
    activeTask &&
      nextTask &&
      activeTask.id !== nextTask.id &&
      !activeTask.blockedReason &&
      recommendedTaskIndex != null,
  );

  useEffect(() => {
    if (!selectedTaskId) return;
    const selected = queue.find((t) => t.id === selectedTaskId);
    if (!selected || selected.blockedReason) {
      setSelectedTaskId(null);
    }
  }, [queue, selectedTaskId]);

  useEffect(() => {
    if (!openTimer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openTimer]);

  const isTimerOnActiveTask = Boolean(
    openTimer && activeTask && openTimer.taskId && openTimer.taskId === activeTask.id,
  );
  const isTimerOnOtherTask = Boolean(openTimer && !isTimerOnActiveTask);
  const isActiveTaskBlocked = Boolean(activeTask?.blockedReason);
  const isGroupedActiveTask = (activeTask?.groupPendingCount ?? 1) > 1;
  const canCompleteSingle = !isActiveTaskBlocked && (!openTimer || isTimerOnActiveTask);
  const canCompleteMultiple = !isActiveTaskBlocked && isTimerOnActiveTask;

  useEffect(() => {
    setGroupedQuantity("1");
  }, [activeTask?.id, activeTask?.groupPendingCount]);

  const timerText = useMemo(() => {
    if (!openTimer) return null;
    const started = new Date(openTimer.startedAt).getTime();
    return formatHms(now - started);
  }, [now, openTimer]);

  function renderQueueTaskDetails(t: WorkerQueueTask, idx: number) {
    return (
      <>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{t.projectName}</div>
          <div className="font-medium truncate">
            {idx + 1}. {t.lampName}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            Elemento: {t.elementLabel} · Medida: {t.measureLabel}
          </div>
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1 flex-wrap">
            <span>{processLabels[t.process] ?? t.process}</span>
            <WorkOrderBadge
              number={t.workOrderNumber}
              status={t.workOrderStatus ?? undefined}
            />
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
        <div className="font-mono text-xs tabular-nums shrink-0">
          {t.blockedReason ? "Bloqueada" : activeTask?.id === t.id ? "Activa" : "Libre"}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Tarea activa</span>
            {openTimer ? (
              <span className="font-mono text-sm text-muted-foreground">{timerText}</span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!activeTask ? (
            <div className="text-sm text-muted-foreground">No tienes tareas pendientes.</div>
          ) : (
            <>
              <div {...withWorkOrderHighlight(activeTask.workOrderNumber, "space-y-1")}>
                <div className="text-xs text-muted-foreground">{activeTask.projectName}</div>
                <div className="text-lg font-semibold">{activeTask.lampName}</div>
                <div className="text-xs text-muted-foreground">
                  Elemento: {activeTask.elementLabel} · Medida: {activeTask.measureLabel}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>{processLabels[activeTask.process] ?? activeTask.process} · No completada</span>
                  <WorkOrderBadge
                    number={activeTask.workOrderNumber}
                    status={activeTask.workOrderStatus ?? undefined}
                  />
                  {isGroupedActiveTask ? (
                    <span>· {activeTask.groupPendingCount} iguales pendientes</span>
                  ) : null}
                </div>
                {activeTask.blockedReason ? (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    {activeTask.blockedReason}
                  </div>
                ) : null}
                {showsRecommendedHint && nextTask ? (
                  <div className="text-xs text-muted-foreground">
                    Tarea recomendada: #{recommendedTaskIndex} · {nextTask.lampName} ·{" "}
                    {processLabels[nextTask.process] ?? nextTask.process}
                  </div>
                ) : null}
                {isGroupedActiveTask && !isTimerOnActiveTask ? (
                  <div className="text-xs text-muted-foreground">
                    Para completar varias tareas agrupadas con reparto automático, inicia el timer
                    en esta tarea o usa registro manual.
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  Horario planificado:{" "}
                  {activeTask.plannedRanges.length > 0
                    ? activeTask.plannedRanges.join(" · ")
                    : "Sin franja planificada"}
                </div>
              </div>

              {isTimerOnOtherTask ? (
                <div className="rounded-md border p-3 text-sm">
                  <div className="font-medium">Tienes un timer activo</div>
                  <div className="text-muted-foreground">
                    Proyecto: {openTimer!.projectName}. Para continuar, primero para el contador.
                  </div>
                </div>
              ) : null}

              <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-2", isGroupedActiveTask && "lg:grid-cols-5", !isGroupedActiveTask && "lg:grid-cols-4")}>
                <Button
                  disabled={pending || !!openTimer || isActiveTaskBlocked}
                  className="gap-2 w-full"
                  onClick={() => {
                    if (!activeTask) return;
                    startTransition(async () => {
                      const result = await startTimer({
                          projectId: activeTask.projectId,
                          lampId: activeTask.lampId,
                          taskId: activeTask.id,
                          process: activeTask.process,
                        });
                      const outcome = handleActionResult("task-queue.start", result);
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success("Timer iniciado");
                    });
                  }}
                >
                  <Play className="size-4" />
                  Iniciar
                </Button>

                <Button
                  variant="destructive"
                  disabled={pending || !openTimer}
                  className="gap-2 w-full"
                  onClick={() => {
                    if (!openTimer) return;
                    startTransition(async () => {
                      const result = await stopTimer({ entryId: openTimer.id });
                      const outcome = handleActionResult("task-queue.stop", result);
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success("Timer parado");
                    });
                  }}
                >
                  <Square className="size-4" />
                  Parar
                </Button>

                <Button
                  variant="secondary"
                  disabled={pending || !activeTask || !canCompleteSingle}
                  className={cn("gap-2 w-full")}
                  onClick={() => {
                    if (!activeTask) return;
                    startTransition(async () => {
                      const result =
                        isGroupedActiveTask && openTimer && isTimerOnActiveTask
                          ? await recordAndCompleteGroupedOtTasks({
                              mode: "timer",
                              taskId: activeTask.id,
                              timerEntryId: openTimer.id,
                              quantity: 1,
                            })
                          : await completeTask({ taskId: activeTask.id });
                      const outcome = handleActionResult("task-queue.complete", result);
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success("Tarea completada");
                    });
                  }}
                >
                  <CheckCircle2 className="size-4" />
                  Completar 1
                </Button>
                {isGroupedActiveTask ? (
                  <Button
                    variant="secondary"
                    disabled={pending || !activeTask || !canCompleteMultiple}
                    className="gap-2 w-full"
                    onClick={() => setShowGroupedDialog(true)}
                  >
                    <CheckCircle2 className="size-4" />
                    Completar varias
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  disabled={pending || !activeTask}
                  className="gap-2 w-full"
                  onClick={() => setShowManual((v) => !v)}
                >
                  <ClipboardPenLine className="size-4" />
                  Registro manual
                </Button>
              </div>

              {showManual && activeTask ? (
                <div className="rounded-md border p-3">
                  <ManualEntryForm
                    projects={projects}
                    manualBreakSchedule={manualBreakSchedule}
                    processLabels={processLabels}
                    lockTaskSelection
                    preset={{
                      projectId: activeTask.projectId,
                      lampId: activeTask.lampId,
                      taskId: activeTask.id,
                      process: activeTask.process,
                      ranges: activeTask.plannedDateRanges,
                    }}
                  />
                </div>
              ) : null}

              <Dialog open={showGroupedDialog} onOpenChange={setShowGroupedDialog}>
                <DialogContent className="w-full max-w-sm sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Completar tareas agrupadas</DialogTitle>
                    <DialogDescription>
                      Se crearán registros individuales por tarea con reparto proporcional por
                      medida.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="grouped-quantity">Cantidad completada</Label>
                      <Select value={groupedQuantity} onValueChange={(value) => setGroupedQuantity(value ?? "1")}>
                        <SelectTrigger id="grouped-quantity" className="h-10">
                          <SelectValue placeholder="Selecciona cantidad" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(
                            { length: Math.max(1, activeTask?.groupPendingCount ?? 1) },
                            (_, idx) => idx + 1,
                          ).map((amount) => (
                            <SelectItem key={amount} value={String(amount)}>
                              {amount}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Se registrarán entradas individuales para las {groupedQuantity} primeras
                      tareas pendientes del grupo.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowGroupedDialog(false)}
                      disabled={pending}
                    >
                      Cancelar
                    </Button>
                    <Button
                      disabled={pending || !activeTask || !openTimer || !isTimerOnActiveTask}
                      onClick={() => {
                        if (!activeTask || !openTimer) return;
                        startTransition(async () => {
                          const quantity = Number(groupedQuantity) || 1;
                          const result = await recordAndCompleteGroupedOtTasks({
                            mode: "timer",
                            taskId: activeTask.id,
                            timerEntryId: openTimer.id,
                            quantity,
                          });
                          const outcome = handleActionResult("task-queue.complete-grouped", result);
                          if (!outcome.success) {
                            toast.error(outcome.message);
                            return;
                          }
                          toast.success(`Completadas ${quantity} tareas agrupadas`);
                          setShowGroupedDialog(false);
                        });
                      }}
                    >
                      Completar y repartir horas
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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
            <>
              <p className="text-xs text-muted-foreground">
                Selecciona una tarea libre para fichar sobre ella.
              </p>
              <ul className={cn("space-y-2", queue.length > 5 && "max-h-96 overflow-y-auto pr-1")}>
                {queue.slice(0, 20).map((t, idx) => {
                  const isActive = activeTask?.id === t.id;
                  const isFree = !t.blockedReason;

                  if (isFree) {
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedTaskId(t.id)}
                          {...withWorkOrderHighlight(
                            t.workOrderNumber,
                            cn(
                              "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50",
                              isActive && "border-primary",
                            ),
                          )}
                        >
                          {renderQueueTaskDetails(t, idx)}
                        </button>
                      </li>
                    );
                  }

                  return (
                    <li
                      key={t.id}
                      {...withWorkOrderHighlight(
                        t.workOrderNumber,
                        cn(
                          "flex items-center justify-between gap-3 rounded-md border px-3 py-2 opacity-70 cursor-not-allowed",
                        ),
                      )}
                    >
                      {renderQueueTaskDetails(t, idx)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
