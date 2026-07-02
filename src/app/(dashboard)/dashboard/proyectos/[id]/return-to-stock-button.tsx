"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { returnLampToStock } from "@/features/stock/actions";
import { toast } from "sonner";

export function ReturnToStockButton({
  lampId,
  lampName,
  hasPlanning,
}: {
  lampId: string;
  lampName: string;
  hasPlanning: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [confirmClearPlanning, setConfirmClearPlanning] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            startTransition(async () => {
              try {
                await returnLampToStock({
                  lampId,
                  reason: reason || undefined,
                  confirmClearPlanning: hasPlanning ? confirmClearPlanning : undefined,
                });
                toast.success("Lámpara devuelta a stock");
                setOpen(false);
                router.refresh();
              } catch (err) {
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. cambio de especificación"
            />
          </div>
          {hasPlanning ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={confirmClearPlanning}
                onCheckedChange={(checked) =>
                  setConfirmClearPlanning(checked === true)
                }
              />
              <span>
                Eliminar las asignaciones de planning de esta lámpara al devolverla
                a stock.
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || (hasPlanning && !confirmClearPlanning)}
            >
              Devolver a stock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
