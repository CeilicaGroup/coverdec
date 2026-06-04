"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import type { ProcessCode } from "@/types/process";
import {
  aggregateTasksByProcess,
  groupTasksByBastidor,
  type TaskHoursAggregate,
} from "@/features/projects/lamp-tasks";
import {
  addExtraTask,
  deleteTask,
  reorderTask,
  updateTaskHours,
  updateTaskNotes,
} from "@/features/projects/actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

interface LampTaskRow {
  id: string;
  process: ProcessCode;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  order: number;
  notes: string | null;
  naveId: string | null;
  lampFrame:
    | {
        id: string;
        label: string | null;
        surfaceM2: number | null;
        frameType: { id: string; name: string };
      }
    | null;
}

type TaskViewMode = "agrupada" | "detalle";

function bastidorSummaryLabel(
  frameTypeName: string,
  unitCount: number,
  surfaceM2: number | null,
): string {
  const parts = [frameTypeName];
  if (surfaceM2 != null) parts.push(`${surfaceM2} m²`);
  if (unitCount > 1) parts.push(`${unitCount} uds`);
  return parts.join(" · ");
}

function AggregatedTaskTable({
  rows,
  processStylesByCode,
  waitHoursByProcess,
  showUnits,
}: {
  rows: TaskHoursAggregate[];
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  waitHoursByProcess: Record<string, number>;
  showUnits: boolean;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-medium py-1.5 px-3 w-8">#</th>
          <th className="text-left font-medium py-1.5 px-2">Proceso</th>
          <th className="text-right font-medium py-1.5 px-2">Est.</th>
          <th className="text-right font-medium py-1.5 px-2">Hecho</th>
          <th className="text-right font-medium py-1.5 px-2">Pend.</th>
          <th className="text-right font-medium py-1.5 px-2">Espera tras</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const prev = idx > 0 ? rows[idx - 1] : null;
          const waitAfter = prev
            ? (waitHoursByProcess[prev.process] ?? 0)
            : 0;
          return (
            <tr key={row.process} className="border-t border-border/50">
              <td className="py-1.5 px-3 text-muted-foreground">{idx + 1}</td>
              <td className="py-1.5 px-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <ProcessBadge
                    code={row.process}
                    definition={processStylesByCode[row.process]}
                  />
                  {showUnits && row.units > 1 ? (
                    <span className="text-[10px] text-muted-foreground">
                      ×{row.units}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {formatHours(row.estimatedHours)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {formatHours(row.doneHours)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono font-semibold">
                {formatHours(row.pendingHours)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                {waitAfter > 0 ? `${waitAfter}h` : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function LampTasksPanel({
  lampId,
  tasks,
  usedProcesses,
  waitHoursByProcess,
  processStylesByCode,
  canManage,
  naves = [],
}: {
  lampId: string;
  tasks: LampTaskRow[];
  usedProcesses: ProcessCode[];
  waitHoursByProcess: Record<string, number>;
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  canManage: boolean;
  naves?: NaveSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<TaskViewMode>("agrupada");
  const [editTask, setEditTask] = useState<LampTaskRow | null>(null);
  const [editHours, setEditHours] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addProcess, setAddProcess] = useState("");
  const [addHours, setAddHours] = useState("");

  const availableProcesses = Object.keys(waitHoursByProcess).filter(
    (p) => !usedProcesses.includes(p),
  );

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => a.order - b.order),
    [tasks],
  );

  const bastidorGroups = useMemo(() => groupTasksByBastidor(sorted), [sorted]);

  const hasMultipleBastidores = bastidorGroups.length > 1;
  const showViewToggle =
    hasMultipleBastidores || bastidorGroups.some((g) => g.unitCount > 1);
  const effectiveViewMode: TaskViewMode = showViewToggle ? viewMode : "detalle";

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 px-3">Sin tareas</p>
    );
  }

  return (
    <div className="border-t bg-muted/20">
      {showViewToggle ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/50">
          <div className="flex rounded-lg border p-0.5 bg-background">
            <Button
              type="button"
              variant={viewMode === "agrupada" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setViewMode("agrupada")}
            >
              Agrupada
            </Button>
            <Button
              type="button"
              variant={viewMode === "detalle" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setViewMode("detalle")}
            >
              Detalle
            </Button>
          </div>
          {viewMode === "agrupada" && canManage ? (
            <p className="text-[10px] text-muted-foreground">
              Editar o reordenar en vista detalle
            </p>
          ) : null}
        </div>
      ) : null}

      {effectiveViewMode === "agrupada" ? (
        <div className="divide-y divide-border/50">
          {bastidorGroups.map((group) => {
            const aggregated = aggregateTasksByProcess(group.tasks);
            return (
              <section key={group.key}>
                <div className="px-3 py-2 bg-muted/30 text-xs font-medium">
                  {bastidorSummaryLabel(
                    group.frameTypeName,
                    group.unitCount,
                    group.surfaceM2,
                  )}
                </div>
                <AggregatedTaskTable
                  rows={aggregated}
                  processStylesByCode={processStylesByCode}
                  waitHoursByProcess={waitHoursByProcess}
                  showUnits={group.unitCount > 1}
                />
              </section>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {bastidorGroups.map((group) => (
              <section key={group.key}>
                {hasMultipleBastidores || group.unitCount > 1 ? (
                  <div className="px-3 py-2 bg-muted/30 text-xs font-medium">
                    {bastidorSummaryLabel(
                      group.frameTypeName,
                      group.unitCount,
                      group.surfaceM2,
                    )}
                  </div>
                ) : null}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium py-1.5 px-3 w-8">#</th>
                      <th className="text-left font-medium py-1.5 px-2">Proceso</th>
                      {group.unitCount > 1 ? (
                        <th className="text-left font-medium py-1.5 px-2">Unidad</th>
                      ) : null}
                      <th className="text-right font-medium py-1.5 px-2">Est.</th>
                      <th className="text-right font-medium py-1.5 px-2">Hecho</th>
                      <th className="text-right font-medium py-1.5 px-2">Pend.</th>
                      <th className="text-right font-medium py-1.5 px-2">Espera tras</th>
                      {canManage ? (
                        <th className="text-right font-medium py-1.5 px-2 w-28" />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...group.tasks]
                      .sort((a, b) => a.order - b.order)
                      .map((t, idx, groupSorted) => {
                        const prev = idx > 0 ? groupSorted[idx - 1] : null;
                        const waitAfter = prev
                          ? (waitHoursByProcess[prev.process] ?? 0)
                          : 0;
                        return (
                          <tr key={t.id} className="border-t border-border/50">
                            <td className="py-1.5 px-3 text-muted-foreground">
                              {t.order + 1}
                            </td>
                            <td className="py-1.5 px-2">
                              <ProcessBadge
                                code={t.process}
                                definition={processStylesByCode[t.process]}
                              />
                            </td>
                            {group.unitCount > 1 ? (
                              <td className="py-1.5 px-2 text-muted-foreground">
                                {t.lampFrame?.label ??
                                  t.lampFrame?.frameType.name ??
                                  "—"}
                              </td>
                            ) : null}
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatHours(t.estimatedHours)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatHours(t.doneHours)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-semibold">
                              {formatHours(t.pendingHours)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                              {waitAfter > 0 ? `${waitAfter}h` : "—"}
                            </td>
                            {canManage ? (
                              <td className="py-1.5 px-2 text-right">
                                <div className="flex justify-end gap-0.5">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      startTransition(async () => {
                                        try {
                                          await reorderTask({
                                            taskId: t.id,
                                            direction: "up",
                                          });
                                          router.refresh();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Error",
                                          );
                                        }
                                      });
                                    }}
                                    aria-label="Subir tarea"
                                  >
                                    <ArrowUp className="size-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={idx === groupSorted.length - 1}
                                    onClick={() => {
                                      startTransition(async () => {
                                        try {
                                          await reorderTask({
                                            taskId: t.id,
                                            direction: "down",
                                          });
                                          router.refresh();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Error",
                                          );
                                        }
                                      });
                                    }}
                                    aria-label="Bajar tarea"
                                  >
                                    <ArrowDown className="size-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => {
                                      setEditTask(t);
                                      setEditHours(String(t.estimatedHours));
                                      setEditNotes(t.notes ?? "");
                                    }}
                                    aria-label="Editar tarea"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                      "size-7 text-destructive",
                                    )}
                                    disabled={t.doneHours > 0}
                                    onClick={() => {
                                      if (
                                        !confirm(
                                          `¿Eliminar la tarea ${t.process}?`,
                                        )
                                      ) {
                                        return;
                                      }
                                      startTransition(async () => {
                                        try {
                                          await deleteTask({ taskId: t.id });
                                          toast.success("Tarea eliminada");
                                          router.refresh();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Error",
                                          );
                                        }
                                      });
                                    }}
                                    aria-label="Eliminar tarea"
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </section>
          ))}
        </div>
      )}

      {canManage && availableProcesses.length > 0 ? (
        <div className="px-3 py-2 border-t">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setAddProcess(availableProcesses[0] ?? "");
              setAddHours("");
              setAddOpen(true);
            }}
          >
            <Plus className="size-3" />
            Añadir proceso extra
          </Button>
        </div>
      ) : null}

      <Dialog open={editTask != null} onOpenChange={(o) => !o && setEditTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar tarea</DialogTitle>
          </DialogHeader>
          {editTask ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const h = Number(editHours);
                if (!h || h <= 0) {
                  toast.error("Horas inválidas");
                  return;
                }
                startTransition(async () => {
                  try {
                    await updateTaskHours({
                      taskId: editTask.id,
                      estimatedHours: h,
                    });
                    await updateTaskNotes({
                      taskId: editTask.id,
                      notes: editNotes.trim() || null,
                    });
                    toast.success("Tarea actualizada");
                    setEditTask(null);
                    router.refresh();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Error");
                  }
                });
              }}
            >
              <div className="flex items-center gap-2">
                <ProcessBadge
                  code={editTask.process}
                  definition={processStylesByCode[editTask.process]}
                />
                {editTask.lampFrame?.label ? (
                  <span className="text-xs text-muted-foreground">
                    {editTask.lampFrame.label}
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Horas estimadas</Label>
                <Input
                  type="number"
                  step={0.25}
                  min={0.25}
                  required
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Añadir proceso extra</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const h = Number(addHours);
              if (!addProcess || !h || h <= 0) {
                toast.error("Completa proceso y horas");
                return;
              }
              startTransition(async () => {
                try {
                  await addExtraTask({
                    lampId,
                    process: addProcess,
                    estimatedHours: h,
                  });
                  toast.success("Proceso añadido");
                  setAddOpen(false);
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Error");
                }
              });
            }}
          >
            <div className="space-y-2">
              <Label>Proceso</Label>
              <Select value={addProcess} onValueChange={(v) => setAddProcess(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProcesses.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Horas estimadas</Label>
              <Input
                type="number"
                step={0.25}
                min={0.25}
                required
                value={addHours}
                onChange={(e) => setAddHours(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Añadir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
