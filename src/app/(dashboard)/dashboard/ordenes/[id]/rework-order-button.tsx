"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { ProductionOrderKind, ProductionOrderStatus } from "@/generated/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createReworkOrderAction } from "@/features/production-orders/actions";
import { reportMutationError } from "@/lib/mutation-error";

const ALLOWED = new Set<ProductionOrderStatus>([
  ProductionOrderStatus.CURSO,
  ProductionOrderStatus.MULTI,
  ProductionOrderStatus.INT,
  ProductionOrderStatus.CERR,
]);

export function ReworkOrderButton({
  orderId,
  status,
  kind,
  canManage,
  defaultHours,
  defaultProcess,
}: {
  orderId: string;
  status: ProductionOrderStatus;
  kind: ProductionOrderKind;
  canManage: boolean;
  defaultHours: number | null;
  defaultProcess: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(defaultHours ? String(defaultHours) : "");
  const [notes, setNotes] = useState("");

  if (!canManage || kind === ProductionOrderKind.ORT || !ALLOWED.has(status)) {
    return null;
  }

  const submit = () => {
    startTransition(async () => {
      try {
        const parsedHours = hours.trim() ? Number(hours) : undefined;
        if (parsedHours != null && (Number.isNaN(parsedHours) || parsedHours <= 0)) {
          toast.error("Horas inválidas");
          return;
        }
        const result = await createReworkOrderAction({
          parentOrderId: orderId,
          process: defaultProcess ?? undefined,
          hours: parsedHours,
          notes: notes.trim() || undefined,
        });
        toast.success(`ORT creada: ${result.number}`);
        setOpen(false);
        router.push(`/dashboard/ordenes/${result.id}`);
        router.refresh();
      } catch (err) {
        toast.error(reportMutationError("No se pudo crear la ORT", err));
      }
    });
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wrench className="size-3.5 mr-1" />
        Crear retrabajo
      </Button>
    );
  }

  return (
    <div className="no-print rounded-lg border bg-background p-3 space-y-3 max-w-sm">
      <div className="text-sm font-semibold">Nueva ORT</div>
      <div className="space-y-1">
        <Label className="text-xs">Horas estimadas (opcional)</Label>
        <Input
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="font-mono h-8"
          disabled={pending}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Motivo</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          disabled={pending}
          placeholder="Defecto detectado, reproceso…"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Confirmar ORT"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
