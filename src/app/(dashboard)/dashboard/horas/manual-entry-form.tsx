"use client";

import { useState, useTransition } from "react";
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
import { createManualEntry } from "@/features/time-tracking/actions";
import { toast } from "sonner";

export function ManualEntryForm({
  projects,
  processLabels = {},
}: {
  projects: {
    id: string;
    name: string;
    lamps: { id: string; name: string }[];
    tasks: { id: string; process: string; lampId: string }[];
  }[];
  processLabels?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [lampId, setLampId] = useState("");
  const [process, setProcess] = useState("");
  const [hours, setHours] = useState("1");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));

  const project = projects.find((p) => p.id === projectId);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!projectId) {
          toast.error("Selecciona proyecto");
          return;
        }
        const numericHours = Number(hours);
        if (!Number.isFinite(numericHours) || numericHours <= 0) {
          toast.error("Horas inválidas");
          return;
        }
        startTransition(async () => {
          try {
            await createManualEntry({
              projectId,
              lampId: lampId || undefined,
              process: process || undefined,
              startedAt: new Date(date).toISOString(),
              hours: numericHours,
              notes: notes || undefined,
            });
            toast.success("Registro creado");
            setNotes("");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error");
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Inicio</Label>
          <Input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Horas</Label>
          <Input
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Proyecto</Label>
        <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
          <SelectTrigger>
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
            <SelectTrigger>
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
        <Label>Proceso</Label>
        <Select value={process} onValueChange={(v) => setProcess(v ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder="(opcional)" />
          </SelectTrigger>
          <SelectContent>
            {[...new Set((project?.tasks ?? []).map((t) => t.process))].map((p) => (
              <SelectItem key={p} value={p}>
                {processLabels[p] ?? p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
