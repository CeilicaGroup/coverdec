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
import { LampElementVisual } from "@/components/lamp-element-visual";
import { assignLampFromStockToProject } from "@/features/stock/actions";
import {
  isOperationCancelled,
  withSimilarLampNameConfirmation,
} from "@/features/projects/lamp-name-client";
import type { ElementTypology } from "@/generated/prisma";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import { formatHours } from "@/lib/format";
import { toast } from "sonner";

export interface StockLampOption {
  id: string;
  name: string;
  elementTypeName: string | null;
  elementTypeId: string | null;
  elementTypology: ElementTypology | null;
  batchCodes: string[];
  pendingHours: number;
  previousProject: { name: string; code: string } | null;
}

export function AssignFromStockDialog({
  projectId,
  stockLamps,
  typologyImages,
  elementTypeImages,
}: {
  projectId: string;
  stockLamps: StockLampOption[];
  typologyImages?: TypologyImageAvailability;
  elementTypeImages?: ElementTypeImageAvailability;
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
  const stockLabelById = useMemo(
    () =>
      new Map(
        stockLamps.map((lamp) => [
          lamp.id,
          `${lamp.name}${lamp.batchCodes[0] ? ` · ${lamp.batchCodes[0]}` : ""}`,
        ]),
      ),
    [stockLamps],
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
                <SelectValue placeholder="Selecciona lámpara">
                  {lampId ? stockLabelById.get(lampId) : undefined}
                </SelectValue>
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
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-2">
              {selected.elementTypeId && selected.elementTypology ? (
                <LampElementVisual
                  label={selected.elementTypeName}
                  typology={selected.elementTypology}
                  typologyImages={typologyImages}
                  elementTypeId={selected.elementTypeId}
                  elementTypeImages={elementTypeImages}
                  size="md"
                  compact
                />
              ) : (
                <div>{selected.elementTypeName ?? "Elemento"}</div>
              )}
              <div>{formatHours(selected.pendingHours)} pendientes</div>
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
