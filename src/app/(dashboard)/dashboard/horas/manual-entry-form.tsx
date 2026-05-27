"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createManualEntriesFromRanges } from "@/features/time-tracking/actions";
import { toast } from "sonner";

export function ManualEntryForm({
  projects,
  processLabels = {},
  preset,
  lockTaskSelection = false,
}: {
  projects: {
    id: string;
    name: string;
    lamps: { id: string; name: string }[];
    tasks: { id: string; process: string; lampId: string }[];
  }[];
  processLabels?: Record<string, string>;
  preset?: {
    projectId: string;
    lampId: string;
    taskId: string;
    process: string;
  } | null;
  lockTaskSelection?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState(preset?.projectId ?? "");
  const [lampId, setLampId] = useState(preset?.lampId ?? "");
  const [taskId, setTaskId] = useState(preset?.taskId ?? "");
  const [notes, setNotes] = useState("");
  const [markCompleted, setMarkCompleted] = useState(true);
  const [ranges, setRanges] = useState(() => [
    {
      startedAt: new Date().toISOString().slice(0, 16),
      endedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    },
  ]);

  const project = projects.find((p) => p.id === projectId);
  const availableTasks = project?.tasks.filter((t) => (lampId ? t.lampId === lampId : true)) ?? [];
  const selectedTask = availableTasks.find((t) => t.id === taskId) ?? null;

  useEffect(() => {
    if (!preset) return;
    setProjectId(preset.projectId);
    setLampId(preset.lampId);
    setTaskId(preset.taskId);
  }, [preset?.projectId, preset?.lampId, preset?.taskId, preset]);

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
          startedAt: new Date(r.startedAt).toISOString(),
          endedAt: new Date(r.endedAt).toISOString(),
        }));
        startTransition(async () => {
          try {
            await createManualEntriesFromRanges({
              projectId,
              lampId: lampId || undefined,
              taskId,
              process: selectedTask.process,
              notes: notes || undefined,
              markCompleted,
              ranges: normalizedRanges,
            });
            toast.success("Registro creado");
            setNotes("");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error");
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label>Proyecto</Label>
        <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
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
          <Select value={lampId} onValueChange={(v) => setLampId(v ?? "")}>
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
            <SelectValue placeholder="Selecciona tarea" />
          </SelectTrigger>
          <SelectContent>
            {availableTasks.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {processLabels[t.process] ?? t.process}
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
              setRanges((prev) => [
                ...prev,
                {
                  startedAt: prev[prev.length - 1]?.endedAt ?? new Date().toISOString().slice(0, 16),
                  endedAt: prev[prev.length - 1]?.endedAt ?? new Date().toISOString().slice(0, 16),
                },
              ])
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
    </form>
  );
}
