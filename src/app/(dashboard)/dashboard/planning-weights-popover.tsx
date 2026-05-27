"use client";

import { useState, useTransition, useEffect } from "react";
import { SlidersHorizontal, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import type { Role } from "@/generated/prisma";
import type { PlanningWeights } from "@/features/planning/policy-schema";
import {
  normalizePlanningWeights,
} from "@/features/planning/policy-schema";
import {
  saveNonlinearDeadlineSettingsAction,
  savePlanningWeightsAction,
} from "@/features/planning/policy-actions";
import { cn } from "@/lib/utils";

export function PlanningWeightsPopover({
  initialWeights,
  initialDeadlineSettings,
  role,
}: {
  initialWeights: PlanningWeights;
  initialDeadlineSettings: {
    globalDeadlineBoost: number;
    deadlineCurveExponent: number;
    overduePenaltyMultiplier: number;
  };
  role: Role;
}) {
  const [open, setOpen] = useState(false);
  const normalizedInitial = normalizePlanningWeights(initialWeights);
  const [advancedWeights, setAdvancedWeights] =
    useState<PlanningWeights>(normalizedInitial);
  const [globalDeadlineBoost, setGlobalDeadlineBoost] = useState(
    initialDeadlineSettings.globalDeadlineBoost,
  );
  const [deadlineCurveExponent, setDeadlineCurveExponent] = useState(
    initialDeadlineSettings.deadlineCurveExponent,
  );
  const [overduePenaltyMultiplier, setOverduePenaltyMultiplier] = useState(
    initialDeadlineSettings.overduePenaltyMultiplier,
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const next = normalizePlanningWeights(initialWeights);
    setAdvancedWeights(next);
    setGlobalDeadlineBoost(initialDeadlineSettings.globalDeadlineBoost);
    setDeadlineCurveExponent(initialDeadlineSettings.deadlineCurveExponent);
    setOverduePenaltyMultiplier(initialDeadlineSettings.overduePenaltyMultiplier);
  }, [initialWeights, initialDeadlineSettings]);

  if (role === "OPERARIO") return null;

  const onSave = () => {
    startTransition(async () => {
      try {
        await Promise.all([
          savePlanningWeightsAction(advancedWeights),
          saveNonlinearDeadlineSettingsAction({
            globalDeadlineBoost,
            deadlineCurveExponent,
            overduePenaltyMultiplier,
          }),
        ]);
        toast.success("Ajustes globales guardados");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudieron guardar");
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "gap-1.5 shrink-0",
        )}
      >
        <SlidersHorizontal className="size-4" />
        Estrategia
      </PopoverTrigger>
      <PopoverContent
        className="gap-3 p-3 max-h-[min(85vh,32rem)] overflow-y-auto"
        side="bottom"
        align="end"
      >
        <PopoverHeader>
          <PopoverTitle className="text-sm">Ajustes globales de estrategia</PopoverTitle>
          <PopoverDescription className="text-xs">
            Estos controles afectan al comportamiento global del solver. La estrategia
            principal se define por proyecto en la tabla de Proyectos.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Refuerzo global de entrega</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {globalDeadlineBoost}%
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={globalDeadlineBoost}
              onValueChange={(v) => {
                const next = typeof v === "number" ? v : v[0];
                if (next != null) setGlobalDeadlineBoost(next);
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Aumenta el peso de urgencia por fecha de entrega en todos los proyectos.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Curva no lineal (proximidad)</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {deadlineCurveExponent.toFixed(1)}
              </span>
            </div>
            <Slider
              min={1}
              max={4}
              step={0.1}
              value={deadlineCurveExponent}
              onValueChange={(v) => {
                const next = typeof v === "number" ? v : v[0];
                if (next != null && !Number.isNaN(next)) {
                  setDeadlineCurveExponent(Number(next.toFixed(1)));
                }
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Valores altos hacen que la urgencia crezca mucho más cerca del deadline.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Multiplicador fuera de fecha</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {overduePenaltyMultiplier.toFixed(1)}x
              </span>
            </div>
            <Slider
              min={1}
              max={8}
              step={0.1}
              value={overduePenaltyMultiplier}
              onValueChange={(v) => {
                const next = typeof v === "number" ? v : v[0];
                if (next != null && !Number.isNaN(next)) {
                  setOverduePenaltyMultiplier(Number(next.toFixed(1)));
                }
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Endurece de forma agresiva el coste del retraso para evitar terminar fuera de plazo.
            </p>
          </div>
        </div>

        <Button className="w-full" size="sm" disabled={pending} onClick={onSave}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar
        </Button>
      </PopoverContent>
    </Popover>
  );
}
