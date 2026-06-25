"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { StockItemState } from "@/generated/prisma";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reportMutationError } from "@/lib/mutation-error";
import { assignStockToProjectAction } from "@/features/stock/actions";
import type { StockItemRow } from "@/features/stock/queries";

export function AssignStockDialog({
  item,
  projects,
}: {
  item: StockItemRow;
  projects: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [units, setUnits] = useState(String(item.units));
  const [ral, setRal] = useState(item.ral ?? "");

  const needsRal = item.state === StockItemState.IMPRIMADO;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ArrowRightLeft className="size-3.5 mr-1" />
        Asignar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar a proyecto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {item.lampLabel} · {item.units} ud disponibles
          </p>
          <div className="space-y-1">
            <Label>Proyecto</Label>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar proyecto" />
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
          <div className="space-y-1">
            <Label htmlFor={`units-${item.id}`}>Unidades</Label>
            <Input
              id={`units-${item.id}`}
              type="number"
              min={1}
              max={item.units}
              className="font-mono"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
          </div>
          {needsRal ? (
            <div className="space-y-1">
              <Label htmlFor={`ral-${item.id}`}>RAL del proyecto</Label>
              <Input
                id={`ral-${item.id}`}
                className="font-mono"
                value={ral}
                onChange={(e) => setRal(e.target.value)}
                placeholder="6018"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Stock con color RAL {item.ral}: solo proyectos con el mismo color.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !projectId || !units}
            onClick={() => {
              const n = Number(units);
              if (!n || n <= 0) return;
              startTransition(async () => {
                try {
                  const result = await assignStockToProjectAction({
                    stockItemId: item.id,
                    projectId,
                    units: n,
                    ral: needsRal ? ral : undefined,
                    colorHex: item.colorHex ?? undefined,
                  });
                  toast.success(
                    `Asignadas ${n} ud · ${result.stockHours}h stock + ${result.paintHours}h pintura`,
                  );
                  setOpen(false);
                } catch (err) {
                  toast.error(reportMutationError("No se pudo asignar", err));
                }
              });
            }}
          >
            Confirmar asignación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
