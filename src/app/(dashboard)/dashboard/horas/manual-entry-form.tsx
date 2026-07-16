"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createManualEntriesFromRanges,
  recordAndCompleteGroupedOtTasks,
} from "@/features/time-tracking/actions";
import {
  fromDatetimeLocalInputValue,
  toDatetimeLocalInputValue,
} from "@/lib/datetime-local";
import { toast } from "sonner";
import {
  summarizeBreakOverlap,
  type BreakHandling,
  type BreakScheduleContext,
} from "@/features/time-tracking/break-handling";

interface ManualBreakScheduleSnapshot {
  weekly: {
    dayOfWeek: number;
    windows: { startMinutes: number; endMinutes: number }[];
  }[];
  overrides: {
    dateIso: string;
    windows: { startMinutes: number; endMinutes: number }[];
  }[];
}

interface ManualSubmitDraft {
  normalizedRanges: { startedAt: string; endedAt: string }[];
  quantity: number;
  shouldUseGroupedAction: boolean;
}

function defaultRange(): { startedAt: string; endedAt: string } {
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    startedAt: toDatetimeLocalInputValue(start),
    endedAt: toDatetimeLocalInputValue(end),
  };
}

export function ManualEntryForm({
  projects,
  manualBreakSchedule,
  processLabels = {},
  preset,
  lockTaskSelection = false,
}: {
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
  processLabels?: Record<string, string>;
  preset?: {
    projectId: string;
    lampId: string;
    taskId: string;
    process: string;
    ranges?: { startedAt: string; endedAt: string }[];
  } | null;
  lockTaskSelection?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState(preset?.projectId ?? "");
  const [lampId, setLampId] = useState(preset?.lampId ?? "");
  const [taskId, setTaskId] = useState(preset?.taskId ?? "");
  const [notes, setNotes] = useState("");
  const [markCompleted, setMarkCompleted] = useState(true);
  const [groupedCompletionCount, setGroupedCompletionCount] = useState("1");
  const [showBreakDecisionDialog, setShowBreakDecisionDialog] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ManualSubmitDraft | null>(null);
  const [pendingBreakOverlapMinutes, setPendingBreakOverlapMinutes] = useState(0);
  const [pendingBreakOverlapSegments, setPendingBreakOverlapSegments] = useState(0);
  const [ranges, setRanges] = useState(() => {
    if (preset?.ranges && preset.ranges.length > 0) {
      return preset.ranges;
    }
    return [defaultRange()];
  });

  const project = projects.find((p) => p.id === projectId);
  const availableTasks =
    project?.tasks.filter((t) => (lampId ? t.lampId === lampId : true)) ?? [];
  const selectedTask = availableTasks.find((t) => t.id === taskId) ?? null;
  const groupedPendingCount = selectedTask?.groupPendingCount ?? 1;
  const breakScheduleContext = useMemo<BreakScheduleContext | null>(() => {
    if (!manualBreakSchedule) return null;
    return {
      weekly: manualBreakSchedule.weekly,
      overrides: manualBreakSchedule.overrides.map((override) => ({
        date: new Date(`${override.dateIso}T00:00:00.000Z`),
        windows: override.windows,
      })),
    };
  }, [manualBreakSchedule]);

  useEffect(() => {
    if (!preset) return;
    setProjectId(preset.projectId);
    setLampId(preset.lampId);
    setTaskId(preset.taskId);
    if (preset.ranges && preset.ranges.length > 0) {
      setRanges(preset.ranges);
    }
  }, [preset?.projectId, preset?.lampId, preset?.taskId, preset]);

  useEffect(() => {
    setGroupedCompletionCount("1");
  }, [taskId, groupedPendingCount]);

  function submitDraft(draft: ManualSubmitDraft, breakHandling?: BreakHandling) {
    startTransition(async () => {
      if (!selectedTask) {
        toast.error("Tarea inválida");
        return;
      }
      const result = draft.shouldUseGroupedAction
        ? await recordAndCompleteGroupedOtTasks({
            mode: "manualRanges",
            projectId,
            lampId: lampId || undefined,
            taskId,
            process: selectedTask.process,
            notes: notes || undefined,
            breakHandling,
            quantity: Math.min(draft.quantity, groupedPendingCount),
            ranges: draft.normalizedRanges,
          })
        : await createManualEntriesFromRanges({
            projectId,
            lampId: lampId || undefined,
            taskId,
            process: selectedTask.process,
            notes: notes || undefined,
            markCompleted,
            breakHandling,
            ranges: draft.normalizedRanges,
          });
      const outcome = handleActionResult("manual-entry.ranges", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success(
        draft.shouldUseGroupedAction
          ? `Registros creados y ${Math.min(draft.quantity, groupedPendingCount)} tareas completadas`
          : breakHandling === "took_break"
            ? "Registro creado con ajuste de descanso"
            : "Registro creado",
      );
      setNotes("");
      setPendingDraft(null);
      setShowBreakDecisionDialog(false);
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!projectId) {
          toast.error("Selecciona proyecto");
          return;
        }
        if (!taskId) {
          toast.error("Selecciona tarea");
          return;
        }
        if (!selectedTask) {
          toast.error("Tarea inválida");
          return;
        }
        const normalizedRanges = ranges.map((r) => ({
          startedAt: fromDatetimeLocalInputValue(r.startedAt),
          endedAt: fromDatetimeLocalInputValue(r.endedAt),
        }));
        const selectedQuantity = Number(groupedCompletionCount) || 1;
        const shouldUseGroupedAction =
          markCompleted && groupedPendingCount > 1 && selectedQuantity > 1;
        const overlap = summarizeBreakOverlap(
          normalizedRanges.map((range) => ({
            startedAt: new Date(range.startedAt),
            endedAt: new Date(range.endedAt),
          })),
          breakScheduleContext,
        );
        const draft: ManualSubmitDraft = {
          normalizedRanges,
          quantity: selectedQuantity,
          shouldUseGroupedAction,
        };
        if (overlap.hasOverlap) {
          setPendingDraft(draft);
          setPendingBreakOverlapMinutes(overlap.overlapMinutes);
          setPendingBreakOverlapSegments(overlap.overlapSegments.length);
          setShowBreakDecisionDialog(true);
          return;
        }
        submitDraft(draft);
      }}
    >
      <div className="space-y-2">
        <Label>Proyecto</Label>
        <Select
          value={projectId}
          onValueChange={(v) => {
            setProjectId(v ?? "");
            setLampId("");
            setTaskId("");
          }}
        >
          <SelectTrigger disabled={lockTaskSelection}>
            <SelectValue placeholder="Selecciona proyecto">
              {projectId ? (projects.find((p) => p.id === projectId)?.name ?? "") : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {project && project.lamps.length > 0 && (
        <div className="space-y-2">
          <Label>Lámpara</Label>
          <Select
            value={lampId}
            onValueChange={(v) => {
              setLampId(v ?? "");
              setTaskId("");
            }}
          >
            <SelectTrigger disabled={lockTaskSelection}>
              <SelectValue placeholder="(opcional)">
                {lampId ? (project.lamps.find((l) => l.id === lampId)?.name ?? "") : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {project.lamps.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>Tarea</Label>
        <Select value={taskId} onValueChange={(v) => setTaskId(v ?? "")}>
          <SelectTrigger disabled={lockTaskSelection}>
            <SelectValue placeholder="Selecciona tarea">
              {selectedTask
                ? `${processLabels[selectedTask.process] ?? selectedTask.process} · ${selectedTask.elementLabel} · ${selectedTask.measureLabel}`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableTasks.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {processLabels[t.process] ?? t.process} · {t.elementLabel} · {t.measureLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Rangos</Label>
        <div className="space-y-2">
          {ranges.map((r, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Inicio</Label>
                <Input
                  type="datetime-local"
                  value={r.startedAt}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRanges((prev) => prev.map((p, i) => (i === idx ? { ...p, startedAt: v } : p)));
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Fin</Label>
                <Input
                  type="datetime-local"
                  value={r.endedAt}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRanges((prev) => prev.map((p, i) => (i === idx ? { ...p, endedAt: v } : p)));
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={pending || ranges.length <= 1}
                onClick={() => setRanges((prev) => prev.filter((_, i) => i !== idx))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={pending || ranges.length >= 20}
            className="w-full gap-2"
            onClick={() =>
              setRanges((prev) => {
                const last = prev[prev.length - 1];
                const fallback = defaultRange();
                return [
                  ...prev,
                  {
                    startedAt: last?.endedAt ?? fallback.startedAt,
                    endedAt: last?.endedAt ?? fallback.endedAt,
                  },
                ];
              })
            }
          >
            <Plus className="size-4" />
            Añadir rango
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <div className="text-sm font-medium">Completar tarea al guardar</div>
          <div className="text-xs text-muted-foreground">
            Si está activado, la tarea pasará a la siguiente al registrar estos rangos.
          </div>
        </div>
        <Button
          type="button"
          variant={markCompleted ? "default" : "outline"}
          disabled={pending}
          onClick={() => setMarkCompleted((v) => !v)}
        >
          {markCompleted ? "Sí" : "No"}
        </Button>
      </div>

      {markCompleted && groupedPendingCount > 1 ? (
        <div className="space-y-2">
          <Label>Cantidad de tareas iguales completadas</Label>
          <Select
            value={groupedCompletionCount}
            onValueChange={(value) => setGroupedCompletionCount(value ?? "1")}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Selecciona cantidad" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: groupedPendingCount }, (_, idx) => idx + 1).map((amount) => (
                <SelectItem key={amount} value={String(amount)}>
                  {amount}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            El tiempo total de los rangos se reparte proporcionalmente por medida en cada tarea.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="(opcional)"
        />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        Registrar
      </Button>

      <Dialog open={showBreakDecisionDialog} onOpenChange={setShowBreakDecisionDialog}>
        <DialogContent className="w-full max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coincide con franja de descanso</DialogTitle>
            <DialogDescription>
              El registro cruza {pendingBreakOverlapSegments} tramo(s) de descanso ({pendingBreakOverlapMinutes}{" "}
              min).
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Indica si ese tiempo se trabajó como extra o si se hizo descanso para ajustar el
            registro.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setShowBreakDecisionDialog(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="secondary"
              disabled={pending || !pendingDraft}
              onClick={() => {
                if (!pendingDraft) return;
                submitDraft(pendingDraft, "worked_extra");
              }}
            >
              He trabajado extra
            </Button>
            <Button
              disabled={pending || !pendingDraft}
              onClick={() => {
                if (!pendingDraft) return;
                submitDraft(pendingDraft, "took_break");
              }}
            >
              He hecho descanso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
