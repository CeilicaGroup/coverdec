"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import {
  addExtraProjectTask,
  deleteTask,
} from "@/features/projects/actions";
import type { NaveSummary } from "@/features/projects/task-nave";
import { TRANSPORT_PROCESS_CODE } from "@/features/projects/transport-tasks";
import { taskHasPlanningAssignments } from "@/features/projects/task-planning-lock";
import { toast } from "sonner";
import type { ProcessCode } from "@/types/process";

interface ProjectExtraTaskRow {
  id: string;
  process: ProcessCode;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  order: number;
  nave: NaveSummary | null;
  _count?: { assignments: number };
}

export function ProjectExtrasPanel({
  projectId,
  tasks,
  availableProcesses,
  processStylesByCode,
  naves,
  canManage,
}: {
  projectId: string;
  tasks: ProjectExtraTaskRow[];
  availableProcesses: string[];
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  naves: NaveSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [process, setProcess] = useState("");
  const [hours, setHours] = useState("");
  const [naveId, setNaveId] = useState(naves[0]?.id ?? "");

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => a.order - b.order),
    [tasks],
  );

  function openDialog() {
    setProcess(availableProcesses[0] ?? "");
    setHours("");
    setNaveId(naves[0]?.id ?? "");
    setOpen(true);
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Procesos del proyecto</CardTitle>
          <p className="text-xs text-muted-foreground">
            Independientes de las lámparas. Quedan al final del proyecto.
          </p>
        </div>
        {canManage && availableProcesses.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={openDialog}
            disabled={pending}
          >
            <Plus className="size-3.5" />
            Extra de proyecto
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay procesos a nivel de proyecto.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-1.5 px-2">Proceso</th>
                <th className="text-left font-medium py-1.5 px-2">Nave</th>
                <th className="text-right font-medium py-1.5 px-2">Est.</th>
                <th className="text-right font-medium py-1.5 px-2">Hecho</th>
                <th className="text-right font-medium py-1.5 px-2">Pend.</th>
                {canManage ? (
                  <th className="text-right font-medium py-1.5 px-2 w-12" />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sorted.map((task) => {
                const planned = taskHasPlanningAssignments(task);
                return (
                  <tr key={task.id} className="border-t">
                    <td className="py-1.5 px-2">
                      <ProcessBadge
                        code={task.process}
                        definition={processStylesByCode[task.process]}
                      />
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground">
                      {task.nave
                        ? `${task.nave.codigo} · ${task.nave.nombre}`
                        : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {formatHours(task.estimatedHours)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {formatHours(task.doneHours)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {formatHours(task.pendingHours)}
                    </td>
                    {canManage ? (
                      <td className="py-1.5 px-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={pending || planned}
                          title={
                            planned
                              ? "No se puede eliminar: hay planificación"
                              : "Eliminar"
                          }
                          onClick={() => {
                            startTransition(async () => {
                              try {
                                await deleteTask({ taskId: task.id });
                                toast.success("Proceso eliminado");
                                router.refresh();
                              } catch (err) {
                                toast.error(reportMutationError("Error", err));
                              }
                            });
                          }}
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extra de proyecto</DialogTitle>
            <DialogDescription>
              No pertenece a ninguna lámpara. Se muestra en esta sección, al final
              del proyecto.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const h = Number(hours);
              if (!process || !h || h <= 0) {
                toast.error("Completa proceso y horas");
                return;
              }
              if (naves.length > 0 && !naveId) {
                toast.error("Selecciona una nave");
                return;
              }
              startTransition(async () => {
                try {
                  await addExtraProjectTask({
                    projectId,
                    process,
                    estimatedHours: h,
                    ...(naveId ? { naveId } : {}),
                  });
                  toast.success("Proceso añadido al proyecto");
                  setOpen(false);
                  router.refresh();
                } catch (err) {
                  toast.error(reportMutationError("Error", err));
                }
              });
            }}
          >
            <div className="space-y-2">
              <Label>Proceso</Label>
              <Select value={process} onValueChange={(v) => setProcess(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProcesses.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p === TRANSPORT_PROCESS_CODE ? "TRANSPORTE" : p}
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
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            {naves.length > 0 ? (
              <div className="space-y-2">
                <Label>Nave</Label>
                <Select value={naveId} onValueChange={(v) => setNaveId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Nave" />
                  </SelectTrigger>
                  <SelectContent>
                    {naves.map((nave) => (
                      <SelectItem key={nave.id} value={nave.id}>
                        {nave.codigo} · {nave.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Añadir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
