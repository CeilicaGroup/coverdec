"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
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
import { createLamp } from "@/features/projects/actions";
import {
  computeTaskBlueprintsFromProcesses,
  formatLampFrameUnitLabel,
  type FrameProcessInput,
} from "@/features/projects/lamp-tasks";
import { formatHours } from "@/lib/format";
import { toast } from "sonner";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";

interface FrameTypeOption {
  id: string;
  name: string;
  processes: (ProcessBadgeStyle & FrameProcessInput)[];
}

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

interface DraftFrame {
  clientId: string;
  frameTypeId: string;
  surfaceM2: string;
  units: string;
}

function newDraftFrame(): DraftFrame {
  return {
    clientId: crypto.randomUUID(),
    frameTypeId: "",
    surfaceM2: "",
    units: "1",
  };
}

function processDefinition(
  processes: FrameTypeOption["processes"],
  code: string,
): ProcessBadgeStyle | undefined {
  const p = processes.find((x) => x.process === code);
  if (!p) return undefined;
  return {
    label: p.label,
    bgColor: p.bgColor,
    fgColor: p.fgColor,
    borderColor: p.borderColor,
  };
}

export function AddLampForm({
  projectId,
  frameTypes,
  naves = [],
  defaultNaveId,
}: {
  projectId: string;
  frameTypes: FrameTypeOption[];
  naves?: NaveSummary[];
  defaultNaveId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [naveId, setNaveId] = useState(defaultNaveId ?? "");
  const [draftFrames, setDraftFrames] = useState<DraftFrame[]>([newDraftFrame()]);

  const frameTypeById = useMemo(
    () => new Map(frameTypes.map((f) => [f.id, f])),
    [frameTypes],
  );

  const resetForm = () => {
    setName("");
    setNaveId(defaultNaveId ?? "");
    setDraftFrames([newDraftFrame()]);
  };

  const updateDraft = (clientId: string, patch: Partial<DraftFrame>) => {
    setDraftFrames((rows) =>
      rows.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)),
    );
  };

  const removeDraft = (clientId: string) => {
    setDraftFrames((rows) => {
      const next = rows.filter((r) => r.clientId !== clientId);
      return next.length > 0 ? next : [newDraftFrame()];
    });
  };

  const parsedFrames = draftFrames.map((row) => {
    const medida = Number(row.surfaceM2);
    const units = Number(row.units) || 1;
    const frameType = row.frameTypeId
      ? frameTypeById.get(row.frameTypeId)
      : undefined;
    const blueprints =
      frameType && medida > 0
        ? computeTaskBlueprintsFromProcesses(frameType.processes, medida)
        : [];
    return { row, medida, units, frameType, blueprints };
  });

  const canSubmit =
    parsedFrames.length > 0 &&
    parsedFrames.every(
      ({ row, medida, frameType, blueprints }) =>
        row.frameTypeId &&
        medida > 0 &&
        frameType &&
        blueprints.length > 0 &&
        Number(row.units) >= 1,
    );

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
            if (!naveId) {
              toast.error("Selecciona una nave");
              return;
            }
            if (!canSubmit) {
              toast.error("Completa todos los bastidores con medida y tareas válidas");
              return;
            }
            startTransition(async () => {
              try {
                await createLamp({
                  projectId,
                  name,
                  naveId,
                  frames: parsedFrames.map(({ row, medida, units }) => ({
                    frameTypeId: row.frameTypeId,
                    surfaceM2: medida,
                    units,
                  })),
                });
                toast.success("Lámpara y tareas creadas");
                setOpen(false);
                resetForm();
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Nombre de la lámpara</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {naves.length > 0 && (
            <div className="space-y-2">
              <Label>Nave</Label>
              <Select value={naveId} onValueChange={(v) => setNaveId(v ?? "")} required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona nave">
                    {naveId ? (naves.find((n) => n.id === naveId)?.nombre ?? "") : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {naves.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.codigo} · {n.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Bastidores</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 h-7"
                disabled={frameTypes.length === 0}
                onClick={() => setDraftFrames((rows) => [...rows, newDraftFrame()])}
              >
                <Plus className="size-3.5" />
                Añadir bastidor
              </Button>
            </div>

            {frameTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground border rounded-md p-3">
                No hay tipos de bastidor activos en el catálogo.
              </p>
            ) : (
              <ul className="space-y-2">
                {parsedFrames.map(
                  ({ row, medida, units, frameType, blueprints }, index) => {
                    const frameName =
                      frameType?.name ??
                      (row.frameTypeId ? "Bastidor" : "Nuevo bastidor");
                    const medidaLabel =
                      medida > 0 ? `${medida} m²` : "sin medida";
                    const taskCount = blueprints.length * units;
                    const unitGroups =
                      frameType && medida > 0 && blueprints.length > 0
                        ? Array.from({ length: units }, (_, i) => ({
                            unitIndex: i + 1,
                            label: formatLampFrameUnitLabel(
                              frameName,
                              i + 1,
                              units,
                            ),
                          }))
                        : [];

                    return (
                      <li
                        key={row.clientId}
                        className="border rounded-lg bg-muted/20 overflow-hidden"
                      >
                        <details className="group" open>
                          <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                            <div className="flex flex-wrap items-end gap-2 p-3">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1 basis-full sm:basis-auto">
                                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                                <span className="text-sm font-medium truncate">
                                  {frameName}
                                  <span className="text-muted-foreground font-normal">
                                    {" "}
                                    · {medidaLabel}
                                    {units > 1 ? ` · ${units} uds` : ""}
                                  </span>
                                </span>
                                {taskCount > 0 ? (
                                  <span className="text-[10px] text-muted-foreground ml-1">
                                    ({taskCount} tareas)
                                  </span>
                                ) : null}
                              </div>

                              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 flex-1 min-w-[12rem]">
                                <div className="space-y-1 sm:min-w-[9rem]">
                                  <Label className="text-[10px] text-muted-foreground">
                                    Tipo
                                  </Label>
                                  <Select
                                    value={row.frameTypeId}
                                    onValueChange={(v) =>
                                      updateDraft(row.clientId, {
                                        frameTypeId: v ?? "",
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Bastidor">
                                        {frameType?.name}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {frameTypes.map((f) => (
                                        <SelectItem key={f.id} value={f.id}>
                                          {f.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1 w-20">
                                  <Label className="text-[10px] text-muted-foreground">
                                    Medida (m²)
                                  </Label>
                                  <Input
                                    type="number"
                                    step={0.01}
                                    min={0.01}
                                    className="h-8 text-xs font-mono"
                                    value={row.surfaceM2}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      updateDraft(row.clientId, {
                                        surfaceM2: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1 w-16">
                                  <Label className="text-[10px] text-muted-foreground">
                                    Uds
                                  </Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    className="h-8 text-xs font-mono"
                                    value={row.units}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      updateDraft(row.clientId, {
                                        units: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </div>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                disabled={draftFrames.length === 1}
                                aria-label={`Quitar bastidor ${index + 1}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  removeDraft(row.clientId);
                                }}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </summary>

                          <div className="border-t px-3 pb-3 pt-2">
                            {!row.frameTypeId ? (
                              <p className="text-xs text-muted-foreground">
                                Elige un tipo de bastidor para ver las tareas.
                              </p>
                            ) : medida <= 0 ? (
                              <p className="text-xs text-muted-foreground">
                                Indica la medida en m² para calcular las horas.
                              </p>
                            ) : blueprints.length === 0 ? (
                              <p className="text-xs text-amber-700 dark:text-amber-400">
                                Este bastidor no genera tareas con esa medida.
                              </p>
                            ) : (
                              <ul className="space-y-3">
                                {unitGroups.map((group) => (
                                  <li key={group.unitIndex}>
                                    <p className="text-[10px] font-medium text-muted-foreground mb-1">
                                      {group.label}
                                    </p>
                                    <ul className="space-y-1">
                                      {blueprints.map((bp) => (
                                        <li
                                          key={`${group.unitIndex}-${bp.process}`}
                                          className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-md bg-background/80"
                                        >
                                          <ProcessBadge
                                            code={bp.process}
                                            definition={processDefinition(
                                              frameType!.processes,
                                              bp.process,
                                            )}
                                          />
                                          <span className="font-mono text-muted-foreground shrink-0">
                                            {formatHours(bp.estimatedHours)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </details>
                      </li>
                    );
                  },
                )}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || !canSubmit || frameTypes.length === 0}
            >
              {pending ? "Creando…" : "Crear lámpara"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
