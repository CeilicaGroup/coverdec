"use client";

import { useState, useTransition } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import { reportMutationError } from "@/lib/mutation-error";
import {
  generateSelectedWorkOrdersAction,
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const selectableBatches =
    batches?.filter((b) => !b.skippedExisting) ?? [];

  const loadPreview = () => {
    startTransition(async () => {
      try {
        const result = await previewWorkOrdersFromPlanningAction({ year, week });
        setBatches(result.batches);
        setSelectedKeys(
          new Set(result.batches.filter((b) => !b.skippedExisting).map((b) => b.batchKey)),
        );
        if (result.batches.length === 0) {
          toast.info("No hay asignaciones publicadas para esa semana");
        }
      } catch (err) {
        toast.error(reportMutationError("No se pudo cargar la vista previa", err));
      }
    });
  };

  const refreshPreview = async () => {
    const preview = await previewWorkOrdersFromPlanningAction({ year, week });
    setBatches(preview.batches);
    setSelectedKeys(
      new Set(preview.batches.filter((b) => !b.skippedExisting).map((b) => b.batchKey)),
    );
  };

  const generateAll = () => {
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
        await refreshPreview();
      } catch (err) {
        toast.error(reportMutationError("No se pudieron generar las OT", err));
      }
    });
  };

  const generateSelected = () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    startTransition(async () => {
      try {
        const result = await generateSelectedWorkOrdersAction({
          year,
          week,
          batchKeys: keys,
        });
        if (result.created === 0) {
          toast.info("Los lotes seleccionados ya existen");
        } else {
          toast.success(
            `Creadas ${result.created} OT${result.numbers.length ? `: ${result.numbers.join(", ")}` : ""}`,
          );
        }
        await refreshPreview();
      } catch (err) {
        toast.error(reportMutationError("No se pudieron generar las OT seleccionadas", err));
      }
    });
  };

  const toggleBatch = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedKeys(
      checked ? new Set(selectableBatches.map((b) => b.batchKey)) : new Set(),
    );
  };

  const allSelected =
    selectableBatches.length > 0 &&
    selectableBatches.every((b) => selectedKeys.has(b.batchKey));

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
            disabled={pending || selectableBatches.length === 0}
            onClick={generateAll}
          >
            Generar todas
            {selectableBatches.length > 0 ? ` (${selectableBatches.length})` : null}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || selectedKeys.size === 0}
            onClick={generateSelected}
          >
            Generar seleccionadas ({selectedKeys.size})
          </Button>
        </div>

        {batches && batches.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => toggleAll(v === true)}
                disabled={selectableBatches.length === 0}
              />
              Seleccionar lotes pendientes
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto text-sm">
              {batches.map((batch) => (
                <div
                  key={batch.batchKey}
                  className="rounded-md border p-2 space-y-1 bg-muted/30"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {!batch.skippedExisting ? (
                      <Checkbox
                        checked={selectedKeys.has(batch.batchKey)}
                        onCheckedChange={(v) => toggleBatch(batch.batchKey, v === true)}
                      />
                    ) : (
                      <span className="w-4" />
                    )}
                    <ProcessBadge code={batch.process} />
                    {batch.batchRal ? (
                      <span className="text-xs font-mono">RAL {batch.batchRal}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground font-mono">
                      {batch.scheduledWeek}
                    </span>
                    <span className="font-mono text-xs">{formatHours(batch.hours)}</span>
                    {batch.skippedExisting ? (
                      <span className="text-xs text-amber-600">Ya generada</span>
                    ) : null}
                  </div>
                  <ul className="text-xs text-muted-foreground pl-6">
                    {batch.lines.map((line) => (
                      <li key={line.taskId}>
                        {line.projectName} · {line.units} ud · {formatHours(line.hours)}
                        {line.ral ? ` · RAL ${line.ral}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
