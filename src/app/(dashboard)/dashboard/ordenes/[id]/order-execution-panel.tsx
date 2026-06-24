"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductionOrderStatus } from "@/generated/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reportMutationError } from "@/lib/mutation-error";
import { formatHours } from "@/lib/format";
import {
  confirmProductionOrderStepAction,
  finishProductionOrderAction,
  pauseProductionOrderAction,
  resumeProductionOrderAction,
  startProductionOrderAction,
} from "@/features/production-orders/actions";

const STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  PEND: "Pendiente",
  CURSO: "En curso",
  INT: "Interrumpida",
  MULTI: "Multiday",
  IMPRIMADO: "Imprimado (almacén)",
  CERR: "Cerrada",
};

interface ExecutionLine {
  id: string;
  units: number;
  completedUnits: number;
  projectName?: string;
}

export function OrderExecutionPanel({
  orderId,
  status,
  step,
  plannedHours,
  actualHours,
  canManage,
  canExecute = canManage,
  lines = [],
}: {
  orderId: string;
  status: ProductionOrderStatus;
  step: number;
  plannedHours: number | null;
  actualHours: number;
  canManage: boolean;
  canExecute?: boolean;
  lines?: ExecutionLine[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pauseReason, setPauseReason] = useState("");
  const [stepHours, setStepHours] = useState("");
  const [completedUnits, setCompletedUnits] = useState("");
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [finishHours, setFinishHours] = useState(
    actualHours > 0 ? String(actualHours) : plannedHours ? String(plannedHours) : "",
  );

  if (!canExecute || status === ProductionOrderStatus.CERR || status === ProductionOrderStatus.IMPRIMADO) return null;

  const run = (fn: () => Promise<unknown>, success: string) => {
    startTransition(async () => {
      try {
        await fn();
        toast.success(success);
        router.refresh();
      } catch (err) {
        toast.error(reportMutationError("Error en la OP", err));
      }
    });
  };

  const totalUnits = lines.reduce((s, l) => s + l.units, 0);
  const doneUnits = lines.reduce((s, l) => s + l.completedUnits, 0);

  return (
    <section className="no-print mb-6 rounded-lg border bg-muted/20 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Ejecución</div>
          <div className="text-xs text-muted-foreground">
            Estado: {STATUS_LABELS[status]} · Paso {step}
            {actualHours > 0 ? ` · ${formatHours(actualHours)} h acumuladas` : null}
            {totalUnits > 0 ? ` · ${doneUnits}/${totalUnits} ud` : null}
          </div>
        </div>
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {status === ProductionOrderStatus.PEND ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => startProductionOrderAction({ orderId }), "OP iniciada")}
          >
            Iniciar
          </Button>
        ) : null}

        {status === ProductionOrderStatus.INT ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => resumeProductionOrderAction({ orderId }), "OP reanudada")}
          >
            Reanudar
          </Button>
        ) : null}

        {status === ProductionOrderStatus.CURSO || status === ProductionOrderStatus.MULTI ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="step-hours" className="text-xs">
                  Horas del paso
                </Label>
                <Input
                  id="step-hours"
                  type="number"
                  step={0.25}
                  min={0.25}
                  className="w-24 font-mono h-8"
                  value={stepHours}
                  onChange={(e) => setStepHours(e.target.value)}
                />
              </div>
              {lines.length > 0 ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="completed-units" className="text-xs">
                      Unidades del paso
                    </Label>
                    <Input
                      id="completed-units"
                      type="number"
                      min={0}
                      className="w-24 font-mono h-8"
                      value={completedUnits}
                      onChange={(e) => setCompletedUnits(e.target.value)}
                    />
                  </div>
                  {lines.length > 1 ? (
                    <div className="space-y-1">
                      <Label htmlFor="line-id" className="text-xs">
                        Línea
                      </Label>
                      <select
                        id="line-id"
                        className="h-8 text-xs border rounded px-2 bg-background"
                        value={lineId}
                        onChange={(e) => setLineId(e.target.value)}
                      >
                        {lines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.projectName ?? line.id} ({line.completedUnits}/{line.units})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !stepHours}
                onClick={() => {
                  const h = Number(stepHours);
                  if (!h || h <= 0) return;
                  const units = completedUnits ? Number(completedUnits) : undefined;
                  run(
                    () =>
                      confirmProductionOrderStepAction({
                        orderId,
                        stepHours: h,
                        ...(units != null && units > 0 && lineId
                          ? { completedUnits: units, lineId }
                          : {}),
                      }),
                    "Paso confirmado",
                  );
                }}
              >
                Confirmar paso
              </Button>
            </div>
            <div className="w-full space-y-1">
              <Label htmlFor="pause-reason" className="text-xs">
                Motivo de pausa
              </Label>
              <div className="flex gap-2">
                <Textarea
                  id="pause-reason"
                  rows={1}
                  className="min-h-8"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !pauseReason.trim()}
                  onClick={() =>
                    run(
                      () =>
                        pauseProductionOrderAction({
                          orderId,
                          reason: pauseReason.trim(),
                        }),
                      "OP pausada",
                    )
                  }
                >
                  Pausar
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {canManage ? (
          <div className="flex items-end gap-2 ml-auto">
            <div className="space-y-1">
              <Label htmlFor="finish-hours" className="text-xs">
                Horas reales (finalizar)
              </Label>
              <Input
                id="finish-hours"
                type="number"
                step={0.25}
                min={0.25}
                className="w-28 font-mono h-8"
                value={finishHours}
                onChange={(e) => setFinishHours(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={pending || !finishHours}
              onClick={() => {
                const h = Number(finishHours);
                if (!h || h <= 0) return;
                run(
                  () => finishProductionOrderAction({ orderId, actualHours: h }),
                  "OP finalizada e imputada",
                );
              }}
            >
              Finalizar
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
