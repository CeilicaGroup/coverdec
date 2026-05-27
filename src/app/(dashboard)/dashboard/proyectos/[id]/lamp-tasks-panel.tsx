"use client";

import { useState, useTransition } from "react";
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
import { ProcessBadge } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import type { ProcessCode } from "@/types/process";
import {
  addExtraTask,
  deleteTask,
  reorderTask,
  updateTaskHours,
  updateTaskNotes,
} from "@/features/projects/actions";
import { updateTaskNave } from "@/features/naves/actions";
import { toast } from "sonner";

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
        label: string | null;
        frameType: { name: string };
      }
    | null;
}

export function LampTasksPanel({
  lampId,
  tasks,
  usedProcesses,
  waitHoursByProcess,
  canManage,
  naves = [],
}: {
  lampId: string;
  tasks: LampTaskRow[];
  usedProcesses: ProcessCode[];
  waitHoursByProcess: Record<string, number>;
  canManage: boolean;
  naves?: NaveSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editTask, setEditTask] = useState<LampTaskRow | null>(null);
  const [editHours, setEditHours] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editNaveId, setEditNaveId] = useState<string>("none");
  const [addOpen, setAddOpen] = useState(false);
  const [addProcess, setAddProcess] = useState("");
  const [addHours, setAddHours] = useState("");

  const availableProcesses = Object.keys(waitHoursByProcess).filter(
    (p) => !usedProcesses.includes(p),
  );

  const sorted = [...tasks].sort((a, b) => a.order - b.order);
  const showFrameColumn = (() => {
    const frameLabels = new Set(
      sorted
        .map((t) => t.lampFrame?.label ?? t.lampFrame?.frameType.name ?? null)
        .filter((x): x is string => Boolean(x)),
    );
    return frameLabels.size > 1;
  })();

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 px-3">Sin tareas</p>
    );
  }

  return (
    <div className="border-t bg-muted/20">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium py-1.5 px-3 w-8">#</th>
            <th className="text-left font-medium py-1.5 px-2">Proceso</th>
            {showFrameColumn ? (
              <th className="text-left font-medium py-1.5 px-2">Bastidor</th>
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
          {sorted.map((t, idx) => {
            const prev = idx > 0 ? sorted[idx - 1] : null;
            const waitAfter = prev
              ? (waitHoursByProcess[prev.process] ?? 0)
              : 0;
            return (
            <tr key={t.id} className="border-t border-border/50">
              <td className="py-1.5 px-3 text-muted-foreground">{t.order + 1}</td>
              <td className="py-1.5 px-2">
                <ProcessBadge code={t.process} />
              </td>
              {showFrameColumn ? (
                <td className="py-1.5 px-2 text-muted-foreground">
                  {t.lampFrame?.label ?? t.lampFrame?.frameType.name ?? "—"}
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
                            await reorderTask({ taskId: t.id, direction: "up" });
                            router.refresh();
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Error",
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
                      disabled={idx === sorted.length - 1}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await reorderTask({ taskId: t.id, direction: "down" });
                            router.refresh();
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Error",
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
                        setEditNaveId(t.naveId ?? "none");
                      }}
                      aria-label="Editar tarea"
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      disabled={t.doneHours > 0}
                      onClick={() => {
                        if (!confirm(`¿Eliminar la tarea ${t.process}?`)) return;
                        startTransition(async () => {
                          try {
                            await deleteTask({ taskId: t.id });
                            toast.success("Tarea eliminada");
                            router.refresh();
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Error",
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
                if (naves.length > 0 && (!editNaveId || editNaveId === "none")) {
                  toast.error("Selecciona una nave");
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
                    if (editNaveId && editNaveId !== "none") {
                      await updateTaskNave(editTask.id, editNaveId);
                    }
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
                <ProcessBadge code={editTask.process} />
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
              {naves.length > 0 && (
                <div className="space-y-2">
                  <Label>Nave</Label>
                  <Select value={editNaveId} onValueChange={(v) => setEditNaveId(v ?? "none")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin asignar</SelectItem>
                      {naves.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
