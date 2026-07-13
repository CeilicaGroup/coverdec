"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { returnLampToStock } from "@/features/stock/actions";
import { toast } from "sonner";

interface StockSelectableUnit {
  id: string;
  label: string;
  hasPlanning: boolean;
}

export function ReturnToStockButton({
  lampId,
  lampName,
  selectableUnits,
  hasPlanning,
}: {
  lampId: string;
  lampName: string;
  selectableUnits: StockSelectableUnit[];
  hasPlanning: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [confirmClearPlanning, setConfirmClearPlanning] = useState(false);

  const showUnitPicker = selectableUnits.length > 1;

  const selectedUnits = useMemo(
    () => selectableUnits.filter((unit) => selectedUnitIds.includes(unit.id)),
    [selectableUnits, selectedUnitIds],
  );

  const selectedHasPlanning = showUnitPicker
    ? selectedUnits.some((unit) => unit.hasPlanning)
    : hasPlanning;

  function resetForm() {
    setReason("");
    setSelectedUnitIds([]);
    setConfirmClearPlanning(false);
  }

  function toggleUnit(unitId: string, checked: boolean) {
    setSelectedUnitIds((current) =>
      checked ? [...current, unitId] : current.filter((id) => id !== unitId),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
          />
        }
      >
        <PackageMinus className="size-3.5" />
        A stock
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Devolver «{lampName}» a stock</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (showUnitPicker && selectedUnitIds.length === 0) {
              toast.error("Selecciona al menos una lámpara para enviar a stock");
              return;
            }
            if (selectedHasPlanning && !confirmClearPlanning) {
              toast.error(
                "Alguna lámpara seleccionada tiene asignaciones de planning. Marca la casilla para confirmarlo.",
              );
              return;
            }
            startTransition(async () => {
              try {
                await returnLampToStock({
                  lampId,
                  reason: reason || undefined,
                  lampElementIds: showUnitPicker ? selectedUnitIds : undefined,
                  confirmClearPlanning: selectedHasPlanning
                    ? confirmClearPlanning
                    : undefined,
                });
                toast.success(
                  showUnitPicker && selectedUnitIds.length < selectableUnits.length
                    ? `${selectedUnitIds.length} lámpara(s) enviada(s) a stock`
                    : "Lámpara devuelta a stock",
                );
                setOpen(false);
                resetForm();
                router.refresh();
              } catch (err) {
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          {showUnitPicker ? (
            <div className="space-y-2">
              <Label>Lámparas a enviar a stock</Label>
              <p className="text-xs text-muted-foreground">
                Elige qué unidades del grupo van al pool de stock. Las no
                seleccionadas permanecen en el proyecto.
              </p>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                {selectableUnits.map((unit) => (
                  <label
                    key={unit.id}
                    className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedUnitIds.includes(unit.id)}
                      onCheckedChange={(checked) =>
                        toggleUnit(unit.id, checked === true)
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{unit.label}</span>
                      {unit.hasPlanning ? (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          Con asignaciones de planning
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. cambio de especificación"
              rows={2}
            />
          </div>
          {selectedHasPlanning ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={confirmClearPlanning}
                onCheckedChange={(checked) =>
                  setConfirmClearPlanning(checked === true)
                }
              />
              <span>
                Eliminar las asignaciones de planning de las lámparas que van a
                stock.
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                pending ||
                (showUnitPicker && selectedUnitIds.length === 0)
              }
            >
              Devolver a stock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
