"use client";

import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reportMutationError } from "@/lib/mutation-error";
import { cancelProductionOrderLineAction } from "@/features/stock/actions";
import type { CancelCandidateRow } from "@/features/stock/queries";

export function CancelOrderLineDialog({ row }: { row: CancelCandidateRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [units, setUnits] = useState(String(row.units));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Ban className="size-3.5 mr-1" />
        Cancelar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar unidades</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-mono font-bold">{row.orderNumber}</span> · {row.projectName}
          </p>
          <p className="text-xs text-muted-foreground rounded-md border p-2 bg-muted/30">
            {row.cancelHint}
          </p>
          <div className="space-y-1">
            <Label htmlFor={`cancel-units-${row.lineId}`}>Unidades a cancelar</Label>
            <Input
              id={`cancel-units-${row.lineId}`}
              type="number"
              min={1}
              max={row.units}
              className="font-mono w-28"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Máximo {row.units} ud</p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              const n = Number(units);
              if (!n || n <= 0 || n > row.units) return;
              startTransition(async () => {
                try {
                  const result = await cancelProductionOrderLineAction({
                    orderId: row.orderId,
                    lineId: row.lineId,
                    units: n,
                  });
                  toast.success(
                    result.movedToStock
                      ? `${n} ud movidas a almacén (${result.stockState})`
                      : `${n} ud reducidas en la OP`,
                  );
                  setOpen(false);
                } catch (err) {
                  toast.error(reportMutationError("No se pudo cancelar", err));
                }
              });
            }}
          >
            Confirmar cancelación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
