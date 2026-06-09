"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { createLamp } from "@/features/projects/actions";
import {
  isOperationCancelled,
  withSimilarLampNameConfirmation,
} from "@/features/projects/lamp-name-client";
import { toast } from "sonner";
import {
  LampElementDraftList,
  newDraftElementRow,
  useParsedElementDrafts,
  type DraftElementRow,
  type ElementTypeOption,
} from "./lamp-element-draft-fields";
import type { ElementTypology, ProjectKind } from "@/generated/prisma";
import { isManualEstimateProjectKind } from "@/lib/project-kind";

type FlexibleLampMode = "elements" | "hours";

export function AddLampForm({
  projectId,
  projectKind,
  elementTypes,
}: {
  projectId: string;
  projectKind: ProjectKind;
  elementTypes: ElementTypeOption[];
}) {
  const router = useRouter();
  const flexibleMode = isManualEstimateProjectKind(projectKind);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lampMode, setLampMode] = useState<FlexibleLampMode>("elements");
  const [name, setName] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [draftRows, setDraftRows] = useState<DraftElementRow[]>([
    newDraftElementRow(),
  ]);

  const parsed = useParsedElementDrafts(draftRows, elementTypes);
  const hoursValue = Number(estimatedHours);
  const hasValidHours =
    estimatedHours.trim().length > 0 && Number.isFinite(hoursValue) && hoursValue > 0;
  const canSubmitElements =
    parsed.length > 0 &&
    parsed.every((p) => p.rowValid) &&
    name.trim().length > 0;
  const canSubmitHours = name.trim().length > 0 && hasValidHours;
  const canSubmit = flexibleMode
    ? lampMode === "hours"
      ? canSubmitHours
      : canSubmitElements
    : canSubmitElements;

  const resetForm = () => {
    setLampMode("elements");
    setName("");
    setEstimatedHours("");
    setDraftRows([newDraftElementRow()]);
  };

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
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
        <Plus className="size-3.5" />
        Lámpara
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[min(90vh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Añadir lámpara</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) {
              toast.error(
                flexibleMode && lampMode === "hours"
                  ? "Indica el nombre y las horas estimadas"
                  : "Completa todos los elementos (tipología, tipo, medida y tareas)",
              );
              return;
            }

            startTransition(async () => {
              try {
                await withSimilarLampNameConfirmation("create", async (confirmSimilarName) => {
                  if (flexibleMode && lampMode === "hours") {
                    await createLamp({
                      projectId,
                      name,
                      estimatedHours: hoursValue,
                      confirmSimilarName,
                    });
                  } else {
                    await createLamp({
                      projectId,
                      name,
                      elements: parsed.map(({ row, medida, units }) => ({
                        typology: row.typology as ElementTypology,
                        elementTypeId: row.elementTypeId,
                        surfaceM2: medida,
                        units,
                      })),
                      confirmSimilarName,
                    });
                  }
                });
                toast.success(
                  flexibleMode && lampMode === "hours"
                    ? "Lámpara creada con horas estimadas"
                    : "Lámpara y tareas creadas",
                );
                setOpen(false);
                resetForm();
                router.refresh();
              } catch (err) {
                if (isOperationCancelled(err)) return;
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Nombre de la lámpara</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {flexibleMode ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Modo de alta</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={lampMode === "elements" ? "default" : "outline"}
                    className="h-auto w-full min-w-0 flex flex-col items-start justify-start gap-1 whitespace-normal py-3 px-3 text-left"
                    onClick={() => setLampMode("elements")}
                  >
                    <span className="text-sm font-medium leading-snug">Por elementos</span>
                    <span className="text-[11px] font-normal leading-snug opacity-80">
                      Tipología, elemento y medida (como en producción)
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant={lampMode === "hours" ? "default" : "outline"}
                    className="h-auto w-full min-w-0 flex flex-col items-start justify-start gap-1 whitespace-normal py-3 px-3 text-left"
                    onClick={() => {
                      setLampMode("hours");
                      setDraftRows([newDraftElementRow()]);
                    }}
                  >
                    <span className="text-sm font-medium leading-snug">Por horas</span>
                    <span className="text-[11px] font-normal leading-snug opacity-80">
                      Total de horas para toda la lámpara
                    </span>
                  </Button>
                </div>
              </div>

              {lampMode === "hours" ? (
                <div className="space-y-2">
                  <Label htmlFor="estimated-hours">Horas estimadas</Label>
                  <Input
                    id="estimated-hours"
                    type="number"
                    step="any"
                    min={0.01}
                    required
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                  />
                </div>
              ) : (
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
                    onUpdate={updateDraft}
                    onRemove={removeDraft}
                  />
                </div>
              )}
            </div>
          ) : (
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
                onUpdate={updateDraft}
                onRemove={removeDraft}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                pending ||
                !canSubmit ||
                ((flexibleMode ? lampMode === "elements" : true) &&
                  elementTypes.length === 0)
              }
            >
              {pending ? "Creando…" : "Crear lámpara"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
