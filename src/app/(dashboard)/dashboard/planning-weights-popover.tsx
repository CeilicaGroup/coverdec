"use client";

import { useState, useTransition, useEffect } from "react";
import { SlidersHorizontal, Loader2, Info } from "lucide-react";
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
import type {
  PlanningStrategy,
  PlanningWeights,
} from "@/features/planning/policy-schema";
import {
  PLANNING_STRATEGY_MAX,
  PLANNING_STRATEGY_PRESETS,
  PLANNING_STRATEGY_STEP,
  PLANNING_WEIGHT_MAX,
  PLANNING_WEIGHT_MIN,
  PLANNING_WEIGHT_STEP,
  normalizePlanningWeights,
  strategyToWeights,
  weightsToStrategy,
} from "@/features/planning/policy-schema";
import {
  savePlanningStrategyAction,
  savePlanningWeightsAction,
} from "@/features/planning/policy-actions";
import { cn } from "@/lib/utils";

const ADVANCED_ROWS: {
  key: keyof PlanningWeights;
  label: string;
  hint: string;
}[] = [
  {
    key: "wLate",
    label: "Retraso vs fecha de entrega",
    hint: "Tier 1: penaliza acabar la lámpara después del deliveryDate del proyecto.",
  },
  {
    key: "wUnscheduled",
    label: "Horas sin asignar",
    hint: "Tier 0: prioriza asignar toda la cola pendiente en la semana.",
  },
  {
    key: "wLaborCost",
    label: "Coste laboral",
    hint: "Minimiza horas normales y extra (tarifas de cada operario).",
  },
  {
    key: "wLoadBalance",
    label: "Balance de carga",
    hint: "Repartir horas entre operarios con trabajo asignado.",
  },
  {
    key: "wMove",
    label: "Estabilidad del plan",
    hint: "Evita cambiar asignaciones respecto al borrador anterior.",
  },
];

function StrategyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 text-[10px] text-muted-foreground leading-snug">
      <Info className="size-3 shrink-0 mt-0.5" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function PlanningWeightsPopover({
  initialWeights,
  role,
}: {
  initialWeights: PlanningWeights;
  role: Role;
}) {
  const [open, setOpen] = useState(false);
  const normalizedInitial = normalizePlanningWeights(initialWeights);

  const [strategy, setStrategy] = useState<PlanningStrategy>(() =>
    weightsToStrategy(normalizedInitial),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedWeights, setAdvancedWeights] =
    useState<PlanningWeights>(normalizedInitial);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const next = normalizePlanningWeights(initialWeights);
    setStrategy(weightsToStrategy(next));
    setAdvancedWeights(next);
  }, [initialWeights]);

  if (role === "OPERARIO") return null;

  const derivedWeights = strategyToWeights(strategy);

  const setStrategyKey = (key: keyof PlanningStrategy, value: number) => {
    setStrategy((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset: PlanningStrategy) => {
    setStrategy(preset);
  };

  const onSave = () => {
    startTransition(async () => {
      try {
        if (advancedOpen) {
          await savePlanningWeightsAction(advancedWeights);
        } else {
          await savePlanningStrategyAction(strategy);
        }
        toast.success("Estrategia de planning guardada");
        setOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "No se pudieron guardar los pesos",
        );
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
          <PopoverTitle className="text-sm">Estrategia del planning</PopoverTitle>
          <PopoverDescription className="text-xs">
            Define si priorizas cumplir la fecha de entrega del proyecto o reducir
            coste. Los días tope de cada proceso (catálogo) siguen siendo reglas fijas.
          </PopoverDescription>
        </PopoverHeader>

        <StrategyHint>
          La <strong>fecha de entrega</strong> (proyecto) mueve el score de retraso. Los{" "}
          <strong>días tope</strong> (imprimación ≤ miércoles, etc.) limitan en qué día puede
          ir cada proceso. Los huecos «Libre» en el grid suelen ser capacidad que no se puede
          usar hasta que termine el proceso anterior de la misma lámpara.
        </StrategyHint>

        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={() => applyPreset(PLANNING_STRATEGY_PRESETS.onTime)}
          >
            A tiempo cueste lo que cueste
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={() => applyPreset(PLANNING_STRATEGY_PRESETS.balanced)}
          >
            Equilibrado
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={() => applyPreset(PLANNING_STRATEGY_PRESETS.minCost)}
          >
            Mínimo coste
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Cumplir entregas</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {strategy.deliveryPriority}%
              </span>
            </div>
            <Slider
              min={0}
              max={PLANNING_STRATEGY_MAX}
              step={PLANNING_STRATEGY_STEP}
              value={strategy.deliveryPriority}
              onValueChange={(v) => {
                const next = typeof v === "number" ? v : v[0];
                if (next != null) setStrategyKey("deliveryPriority", next);
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Sube para acercarte al deliveryDate del proyecto aunque suba el coste.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Minimizar coste</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {strategy.costPriority}%
              </span>
            </div>
            <Slider
              min={0}
              max={PLANNING_STRATEGY_MAX}
              step={PLANNING_STRATEGY_STEP}
              value={strategy.costPriority}
              onValueChange={(v) => {
                const next = typeof v === "number" ? v : v[0];
                if (next != null) setStrategyKey("costPriority", next);
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Sube para priorizar tarifas bajas y horas normales frente a la fecha de entrega.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Estabilidad</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {strategy.stability ?? 50}%
              </span>
            </div>
            <Slider
              min={0}
              max={PLANNING_STRATEGY_MAX}
              step={PLANNING_STRATEGY_STEP}
              value={strategy.stability ?? 50}
              onValueChange={(v) => {
                const next = typeof v === "number" ? v : v[0];
                if (next != null) setStrategyKey("stability", next);
              }}
            />
          </div>
        </div>

        {!advancedOpen ? (
          <p className="text-[10px] text-muted-foreground font-mono">
            Pesos derivados: retraso {derivedWeights.wLate.toFixed(2)} · coste{" "}
            {derivedWeights.wLaborCost.toFixed(2)} · cola{" "}
            {derivedWeights.wUnscheduled.toFixed(2)}
          </p>
        ) : null}

        <details
          className="group"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Ajuste avanzado (pesos del solver)
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {ADVANCED_ROWS.map((row) => (
              <div key={row.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium leading-tight">{row.label}</Label>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {(advancedWeights[row.key] ?? 0).toFixed(2)}
                  </span>
                </div>
                <Slider
                  min={PLANNING_WEIGHT_MIN}
                  max={PLANNING_WEIGHT_MAX}
                  step={PLANNING_WEIGHT_STEP}
                  value={advancedWeights[row.key]}
                  onValueChange={(v) => {
                    const next = typeof v === "number" ? v : v[0];
                    if (next != null && !Number.isNaN(next)) {
                      setAdvancedWeights((prev) => ({ ...prev, [row.key]: next }));
                    }
                  }}
                />
                <p className="text-[10px] text-muted-foreground leading-snug">{row.hint}</p>
              </div>
            ))}
          </div>
        </details>

        <Button className="w-full" size="sm" disabled={pending} onClick={onSave}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar
        </Button>
      </PopoverContent>
    </Popover>
  );
}
