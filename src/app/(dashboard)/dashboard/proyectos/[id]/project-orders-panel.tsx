"use client";

import { useState, useTransition } from "react";
import { Factory, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createProductionOrdersFromProjectAction,
  previewProductionOrdersFromProjectAction,
} from "@/features/production-orders/actions";
import type { ProjectOrderPreview } from "@/features/production-orders/create-from-project";
import { reportMutationError } from "@/lib/mutation-error";
import { formatHours } from "@/lib/format";

export function ProjectOrdersPanel({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [previews, setPreviews] = useState<ProjectOrderPreview[] | null>(null);

  if (!canManage) return null;

  const loadPreview = () => {
    startTransition(async () => {
      try {
        const result = await previewProductionOrdersFromProjectAction({ projectId });
        setPreviews(result.previews);
        if (result.previews.length === 0) {
          toast.info("No hay lámparas con ruta de catálogo en este proyecto");
        }
      } catch (err) {
        toast.error(reportMutationError("No se pudo cargar la vista previa", err));
      }
    });
  };

  const createAll = () => {
    startTransition(async () => {
      try {
        const result = await createProductionOrdersFromProjectAction({ projectId });
        if (result.created === 0) {
          toast.info("Todas las OP ya existen o no hay lotes pendientes");
        } else {
          toast.success(`Creadas ${result.created} OP: ${result.numbers.join(", ")}`);
        }
        const refreshed = await previewProductionOrdersFromProjectAction({ projectId });
        setPreviews(refreshed.previews);
      } catch (err) {
        toast.error(reportMutationError("No se pudieron crear las OP", err));
      }
    });
  };

  const pendingCount = previews?.filter((p) => !p.skippedExisting).length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Factory className="size-4" />
          OPs multi-nave
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={loadPreview}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Vista previa OPs
          </Button>
          <Button size="sm" disabled={pending || pendingCount === 0} onClick={createAll}>
            Crear OPs del proyecto
            {pendingCount > 0 ? ` (${pendingCount})` : null}
          </Button>
        </div>
        {previews && previews.length > 0 ? (
          <div className="overflow-x-auto text-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1">Lámpara</th>
                  <th className="text-left py-1">SKU</th>
                  <th className="text-left py-1">Nave</th>
                  <th className="text-right py-1">Ud</th>
                  <th className="text-right py-1">Horas</th>
                  <th className="text-left py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((p) => (
                  <tr key={`${p.lampId}-${p.naveKey}`} className="border-b border-muted/40">
                    <td className="py-1">{p.lampName}</td>
                    <td className="font-mono py-1">{p.elementTypeCode}</td>
                    <td className="font-mono py-1">{p.naveKey}</td>
                    <td className="text-right font-mono py-1">{p.units}</td>
                    <td className="text-right font-mono py-1">{formatHours(p.hours)}</td>
                    <td className="py-1">
                      {p.skippedExisting ? (
                        <span className="text-amber-600">Ya existe {p.existingOrderNumber}</span>
                      ) : (
                        <span className="text-muted-foreground">Pendiente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
