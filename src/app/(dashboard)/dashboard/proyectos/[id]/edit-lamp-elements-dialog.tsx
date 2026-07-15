"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
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
import { updateLampElements } from "@/features/projects/actions";
import type { LampElementConfig } from "@/features/projects/sync-lamp-elements";
import { toast } from "sonner";
import {
  LampElementDraftList,
  newDraftElementRow,
  useParsedElementDrafts,
  type DraftElementRow,
  type ElementTypeOption,
} from "./lamp-element-draft-fields";
import type { ElementTypology } from "@/generated/prisma";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";

function configsToDraft(
  configs: LampElementConfig[],
  elementTypes: ElementTypeOption[],
): DraftElementRow[] {
  if (configs.length === 0) return [newDraftElementRow()];
  const byId = new Map(elementTypes.map((e) => [e.id, e]));
  return configs.map((c) => ({
    clientId: crypto.randomUUID(),
    typology: c.typology,
    elementTypeId: c.elementTypeId,
    surfaceM2: String(c.surfaceM2),
    units: String(c.units),
  }));
}

export function EditLampElementsDialog({
  lampId,
  lampName,
  initialElements,
  elementTypes,
  typologyImages,
  elementTypeImages,
}: {
  lampId: string;
  lampName: string;
  initialElements: LampElementConfig[];
  elementTypes: ElementTypeOption[];
  typologyImages?: TypologyImageAvailability;
  elementTypeImages?: ElementTypeImageAvailability;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draftRows, setDraftRows] = useState<DraftElementRow[]>(() =>
    configsToDraft(initialElements, elementTypes),
  );

  const initialKey = useMemo(
    () => JSON.stringify(initialElements),
    [initialElements],
  );

  useEffect(() => {
    if (!open) {
      setDraftRows(configsToDraft(initialElements, elementTypes));
    }
  }, [open, initialKey, initialElements, elementTypes]);

  const parsed = useParsedElementDrafts(draftRows, elementTypes);
  const canSubmit = parsed.length > 0 && parsed.every((p) => p.rowValid);

  const updateDraft = (clientId: string, patch: Partial<DraftElementRow>) => {
    setDraftRows((rows) =>
      rows.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)),
    );
  };

  const removeDraft = (clientId: string) => {
    setDraftRows((rows) => {
      const next = rows.filter((r) => r.clientId !== clientId);
      return next.length > 0 ? next : [newDraftElementRow()];
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraftRows(configsToDraft(initialElements, elementTypes));
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" />
        }
      >
        <Pencil className="size-3" />
        Elementos
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[min(90vh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar elementos — {lampName}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) {
              toast.error(
                "Completa todos los elementos (tipología, tipo, medida y tareas)",
              );
              return;
            }
            startTransition(async () => {
              try {
                await updateLampElements({
                  lampId,
                  elements: parsed.map(({ row, medida, units }) => ({
                    typology: row.typology as ElementTypology,
                    elementTypeId: row.elementTypeId,
                    surfaceM2: medida,
                    units,
                  })),
                });
                toast.success("Elementos y tareas actualizados");
                setOpen(false);
                router.refresh();
              } catch (err) {
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <p className="text-xs text-muted-foreground">
            Puedes cambiar metros, unidades o añadir otro elemento. Las
            unidades con horas registradas no se pueden quitar.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Elementos</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 h-7"
                disabled={elementTypes.length === 0}
                onClick={() => setDraftRows((rows) => [...rows, newDraftElementRow()])}
              >
                <Plus className="size-3.5" />
                Añadir elemento
              </Button>
            </div>

            <LampElementDraftList
              draftRows={draftRows}
              elementTypes={elementTypes}
              typologyImages={typologyImages}
              elementTypeImages={elementTypeImages}
              onUpdate={updateDraft}
              onRemove={removeDraft}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
