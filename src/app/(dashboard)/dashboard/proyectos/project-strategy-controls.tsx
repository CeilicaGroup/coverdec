"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectPlanningPreset } from "@/generated/prisma";
import {
  applyGlobalPlanningPresetToActiveProjects,
  applyProjectPlanningPreset,
  updateProjectPlanningStrategy,
} from "@/features/projects/actions";
import { PROJECT_PLANNING_PRESETS } from "@/features/planning/policy-schema";

const PRESET_LABELS: Record<ProjectPlanningPreset, string> = {
  A_TIEMPO: "A tiempo",
  EQUILIBRADO: "Equilibrado",
  MIN_COSTE: "Mínimo coste",
};

function parseSliderValue(value: number | readonly number[]): number | null {
  const next = typeof value === "number" ? value : value[0];
  return typeof next === "number" && !Number.isNaN(next) ? next : null;
}

export function ProjectStrategyControls({
  projectId,
  planningPreset,
  planningCostPriority,
  planningStability,
  planningDeadlineBoost,
}: {
  projectId: string;
  planningPreset: ProjectPlanningPreset;
  planningCostPriority: number;
  planningStability: number;
  planningDeadlineBoost: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preset, setPreset] = useState(planningPreset);
  const [costPriority, setCostPriority] = useState(planningCostPriority);
  const [stability, setStability] = useState(planningStability);
  const [deadlineBoost, setDeadlineBoost] = useState(planningDeadlineBoost);

  const hasChanges = useMemo(
    () =>
      preset !== planningPreset ||
      costPriority !== planningCostPriority ||
      stability !== planningStability ||
      deadlineBoost !== planningDeadlineBoost,
    [
      costPriority,
      deadlineBoost,
      planningCostPriority,
      planningDeadlineBoost,
      planningPreset,
      planningStability,
      preset,
      stability,
    ],
  );

  const onPresetChange = (value: ProjectPlanningPreset | null) => {
    if (!value) return;
    const nextPreset = value;
    setPreset(nextPreset);
    const next = PROJECT_PLANNING_PRESETS[nextPreset];
    setCostPriority(next.costPriority);
    setStability(next.stability);
    setDeadlineBoost(next.deadlineBoost);

    startTransition(async () => {
      try {
        await applyProjectPlanningPreset({ projectId, preset: nextPreset });
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo aplicar el preset");
      }
    });
  };

  const onSave = () => {
    if (!hasChanges) {
      toast.message("No hay cambios por guardar");
      return;
    }
    startTransition(async () => {
      try {
        await updateProjectPlanningStrategy({
          projectId,
          strategy: {
            preset,
            costPriority,
            stability,
            deadlineBoost,
          },
        });
        toast.success("Estrategia del proyecto guardada");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar");
      }
    });
  };

  return (
    <div className="space-y-2 min-w-[280px]">
      <Select value={preset} onValueChange={onPresetChange} disabled={pending}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ProjectPlanningPreset.A_TIEMPO}>
            {PRESET_LABELS.A_TIEMPO}
          </SelectItem>
          <SelectItem value={ProjectPlanningPreset.EQUILIBRADO}>
            {PRESET_LABELS.EQUILIBRADO}
          </SelectItem>
          <SelectItem value={ProjectPlanningPreset.MIN_COSTE}>
            {PRESET_LABELS.MIN_COSTE}
          </SelectItem>
        </SelectContent>
      </Select>
      <SliderRow
        label="Urgencia por entrega"
        value={deadlineBoost}
        onChange={(next) => setDeadlineBoost(next)}
      />
      <SliderRow
        label="Prioridad coste"
        value={costPriority}
        onChange={(next) => setCostPriority(next)}
      />
      <SliderRow
        label="Estabilidad"
        value={stability}
        onChange={(next) => setStability(next)}
      />
      <Button size="sm" className="w-full" onClick={onSave} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Guardar estrategia
      </Button>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-muted-foreground">{value}%</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={5}
        value={value}
        onValueChange={(v) => {
          const next = parseSliderValue(v);
          if (next != null) onChange(next);
        }}
      />
    </div>
  );
}

export function GlobalProjectPresetControl() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<ProjectPlanningPreset>(ProjectPlanningPreset.EQUILIBRADO);

  const onApply = () => {
    startTransition(async () => {
      try {
        const result = await applyGlobalPlanningPresetToActiveProjects({ preset });
        toast.success(`Preset aplicado a ${result.updatedCount} proyectos`);
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo aplicar el preset");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Aplicar estrategia a todos
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar estrategia en masa</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Preset a aplicar en proyectos activos</Label>
          <Select
            value={preset}
            onValueChange={(value) => {
              if (value) setPreset(value);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ProjectPlanningPreset.A_TIEMPO}>{PRESET_LABELS.A_TIEMPO}</SelectItem>
              <SelectItem value={ProjectPlanningPreset.EQUILIBRADO}>
                {PRESET_LABELS.EQUILIBRADO}
              </SelectItem>
              <SelectItem value={ProjectPlanningPreset.MIN_COSTE}>
                {PRESET_LABELS.MIN_COSTE}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={onApply} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
