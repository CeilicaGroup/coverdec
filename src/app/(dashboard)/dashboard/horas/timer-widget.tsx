"use client";

import { useEffect, useState, useTransition } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { startTimer, stopTimer } from "@/features/time-tracking/actions";

interface ProjectOption {
  id: string;
  name: string;
  lamps: { id: string; name: string }[];
  tasks: { id: string; process: string; lampId: string }[];
}

export function TimerWidget({
  openTimer,
  projects,
  processLabels = {},
}: {
  openTimer: { id: string; project: string; startedAt: string } | null;
  projects: ProjectOption[];
  processLabels?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState<string>("");
  const [lampId, setLampId] = useState<string>("");
  const [process, setProcess] = useState<string>("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!openTimer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openTimer]);

  if (openTimer) {
    const seconds = Math.floor((now - new Date(openTimer.startedAt).getTime()) / 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return (
      <div className="space-y-3 text-center">
        <div className="text-sm text-muted-foreground">{openTimer.project}</div>
        <div className="font-mono text-5xl font-black tabular-nums">
          {hh}:{mm}:{ss}
        </div>
        <Button
          variant="destructive"
          disabled={pending}
          className="gap-2"
          onClick={() => {
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
          Parar y registrar
        </Button>
      </div>
    );
  }

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
        startTransition(async () => {
          try {
            await startTimer({
              projectId,
              lampId: lampId || undefined,
              process: process || undefined,
            });
            toast.success("Timer iniciado");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error");
          }
        });
      }}
    >
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
      <Button type="submit" disabled={pending} className="w-full gap-2">
        <Play className="size-4" />
        Iniciar
      </Button>
    </form>
  );
}
