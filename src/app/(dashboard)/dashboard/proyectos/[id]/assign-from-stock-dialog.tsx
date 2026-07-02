"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
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
import { assignLampFromStockToProject } from "@/features/stock/actions";
import {
  isOperationCancelled,
  withSimilarLampNameConfirmation,
} from "@/features/projects/lamp-name-client";
import { formatHours } from "@/lib/format";
import { toast } from "sonner";

export interface StockLampOption {
  id: string;
  name: string;
  elementTypeName: string | null;
  batchCodes: string[];
  pendingHours: number;
  previousProject: { name: string; code: string } | null;
}

export function AssignFromStockDialog({
  projectId,
  stockLamps,
}: {
  projectId: string;
  stockLamps: StockLampOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lampId, setLampId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const selected = useMemo(
    () => stockLamps.find((lamp) => lamp.id === lampId) ?? null,
    [lampId, stockLamps],
  );

  if (stockLamps.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setLampId(null);
          setNewName("");
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" className="gap-2" />}>
        <PackagePlus className="size-4" />
        Asignar desde stock
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar lámpara desde stock</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!lampId) return;
            startTransition(async () => {
              try {
                await withSimilarLampNameConfirmation("create", async (confirmSimilarName) =>
                  assignLampFromStockToProject({
                    lampId,
                    targetProjectId: projectId,
                    newName: newName.trim() || undefined,
                    confirmSimilarName,
                  }),
                );
                toast.success("Lámpara asignada desde stock");
                setOpen(false);
                router.refresh();
              } catch (err) {
                if (isOperationCancelled(err)) return;
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Lámpara en stock</Label>
            <Select
              value={lampId ?? ""}
              onValueChange={(value) => {
                setLampId(value);
                const lamp = stockLamps.find((row) => row.id === value);
                setNewName(lamp?.name ?? "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona lámpara" />
              </SelectTrigger>
              <SelectContent>
                {stockLamps.map((lamp) => (
                  <SelectItem key={lamp.id} value={lamp.id}>
                    {lamp.name}
                    {lamp.batchCodes[0] ? ` · ${lamp.batchCodes[0]}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1">
              <div>
                {selected.elementTypeName ?? "Elemento"} ·{" "}
                {formatHours(selected.pendingHours)} pendientes
              </div>
              {selected.previousProject ? (
                <div className="text-muted-foreground">
                  Procede de {selected.previousProject.name} (
                  {selected.previousProject.code})
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Nombre en el proyecto (opcional)</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={selected?.name ?? "Mismo nombre"}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !lampId}>
              Asignar al proyecto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
