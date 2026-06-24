"use client";

import { useState, useTransition } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import { reportMutationError } from "@/lib/mutation-error";
import {
  generateWorkOrdersFromPlanningAction,
  previewWorkOrdersFromPlanningAction,
} from "@/features/production-orders/actions";
import type { WorkOrderBatchPreview } from "@/features/production-orders/group-from-planning";

export function GenerateWorkOrdersPanel({
  initialYear,
  initialWeek,
}: {
  initialYear: number;
  initialWeek: number;
}) {
  const [year, setYear] = useState(initialYear);
  const [week, setWeek] = useState(initialWeek);
  const [batches, setBatches] = useState<WorkOrderBatchPreview[] | null>(null);
  const [pending, startTransition] = useTransition();

  const loadPreview = () => {
    startTransition(async () => {
      try {
        const result = await previewWorkOrdersFromPlanningAction({ year, week });
        setBatches(result.batches);
        if (result.batches.length === 0) {
          toast.info("No hay asignaciones publicadas para esa semana");
        }
      } catch (err) {
        toast.error(reportMutationError("No se pudo cargar la vista previa", err));
      }
    });
  };

  const generate = () => {
    startTransition(async () => {
      try {
        const result = await generateWorkOrdersFromPlanningAction({ year, week });
        if (result.created === 0) {
          toast.info(
            result.skipped > 0
              ? "Todas las OT de esa semana ya existen"
              : "No hay lotes para generar",
          );
        } else {
          toast.success(
            `Creadas ${result.created} OT${result.numbers.length ? `: ${result.numbers.join(", ")}` : ""}`,
          );
        }
        const preview = await previewWorkOrdersFromPlanningAction({ year, week });
        setBatches(preview.batches);
      } catch (err) {
        toast.error(reportMutationError("No se pudieron generar las OT", err));
      }
    });
  };

  const pendingCreate = batches?.filter((b) => !b.skippedExisting).length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PackagePlus className="size-4" />
          Generar OT desde planning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ot-year" className="text-xs">
              Año ISO
            </Label>
            <Input
              id="ot-year"
              type="number"
              className="w-24 font-mono"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ot-week" className="text-xs">
              Semana
            </Label>
            <Input
              id="ot-week"
              type="number"
              min={1}
              max={53}
              className="w-20 font-mono"
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
            />
          </div>
          <Button variant="outline" size="sm" disabled={pending} onClick={loadPreview}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Vista previa
          </Button>
          <Button
            size="sm"
            disabled={pending || pendingCreate === 0}
            onClick={generate}
          >
            Generar OTs
            {pendingCreate > 0 ? ` (${pendingCreate})` : null}
          </Button>
        </div>

        {batches && batches.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto text-sm">
            {batches.map((batch) => (
              <div
                key={batch.batchKey}
                className="rounded-md border p-2 space-y-1 bg-muted/30"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ProcessBadge code={batch.process} />
                  <span className="text-xs text-muted-foreground font-mono">
                    {batch.scheduledWeek}
                  </span>
                  <span className="font-mono text-xs">{formatHours(batch.hours)}</span>
                  {batch.skippedExisting ? (
                    <span className="text-xs text-amber-600">Ya generada</span>
                  ) : null}
                </div>
                <ul className="text-xs text-muted-foreground pl-2">
                  {batch.lines.map((line) => (
                    <li key={line.taskId}>
                      {line.projectName} · {line.units} ud · {formatHours(line.hours)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
