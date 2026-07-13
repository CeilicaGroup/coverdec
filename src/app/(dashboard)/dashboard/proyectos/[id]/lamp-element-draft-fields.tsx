"use client";

import { useMemo } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import {
  computeTaskBlueprintsFromProcesses,
  scaleBlueprintHoursForUnits,
  type ElementProcessInput,
} from "@/features/projects/lamp-tasks";
import { ELEMENT_TYPOLOGIES } from "@/lib/element-typology";
import { TypologyLabel, TypologySymbol } from "@/components/typology-symbol";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import { formatHours } from "@/lib/format";
import type { ElementTypology } from "@/generated/prisma";

export interface ElementTypeOption {
  id: string;
  name: string;
  typology: ElementTypology;
  processes: (ProcessBadgeStyle & ElementProcessInput)[];
}

export interface DraftElementRow {
  clientId: string;
  typology: ElementTypology | "";
  elementTypeId: string;
  surfaceM2: string;
  units: string;
}

export function newDraftElementRow(): DraftElementRow {
  return {
    clientId: crypto.randomUUID(),
    typology: "",
    elementTypeId: "",
    surfaceM2: "",
    units: "1",
  };
}

function processDefinition(
  processes: ElementTypeOption["processes"],
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

export function useParsedElementDrafts(
  draftRows: DraftElementRow[],
  elementTypes: ElementTypeOption[],
) {
  const elementTypeById = useMemo(
    () => new Map(elementTypes.map((e) => [e.id, e])),
    [elementTypes],
  );

  return draftRows.map((row) => {
    const medida = Number(row.surfaceM2);
    const units = Number(row.units) || 1;
    const elementType = row.elementTypeId
      ? elementTypeById.get(row.elementTypeId)
      : undefined;
    const blueprints =
      elementType && medida > 0
        ? computeTaskBlueprintsFromProcesses(elementType.processes, medida)
        : [];
    const rowValid =
      Boolean(row.typology && row.elementTypeId) &&
      medida > 0 &&
      elementType &&
      elementType.typology === row.typology &&
      blueprints.length > 0 &&
      Number(row.units) >= 1 &&
      true;

    return {
      row,
      medida,
      units,
      elementType,
      blueprints,
      rowValid,
    };
  });
}

export function LampElementDraftList({
  draftRows,
  elementTypes,
  typologyImages,
  onUpdate,
  onRemove,
  removeLabel = "elemento",
}: {
  draftRows: DraftElementRow[];
  elementTypes: ElementTypeOption[];
  typologyImages?: TypologyImageAvailability;
  onUpdate: (clientId: string, patch: Partial<DraftElementRow>) => void;
  onRemove: (clientId: string) => void;
  removeLabel?: string;
}) {
  const parsed = useParsedElementDrafts(draftRows, elementTypes);

  if (elementTypes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border rounded-md p-3">
        No hay tipos de elemento activos en el catálogo.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {parsed.map(
        ({ row, medida, units, elementType, blueprints }, index) => {
          const filteredTypes = row.typology
            ? elementTypes.filter((e) => e.typology === row.typology)
            : [];
          const elementName =
            elementType?.name ??
            (row.elementTypeId ? "Elemento" : "Nuevo elemento");
          const medidaLabel = medida > 0 ? `${medida} m²` : "sin medida";
          const taskCount = blueprints.length * units;
          const aggregatedBlueprints =
            blueprints.length > 0 ? scaleBlueprintHoursForUnits(blueprints, units) : [];

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
                      <span className="text-sm font-medium truncate inline-flex items-center gap-1.5 min-w-0">
                        {row.typology ? (
                          <>
                            <TypologySymbol
                              typology={row.typology}
                              availability={typologyImages}
                              size="sm"
                            />
                            <span className="text-muted-foreground font-normal shrink-0">
                              ·
                            </span>
                          </>
                        ) : null}
                        {elementName}
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

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap gap-2 flex-1 min-w-[12rem]">
                      <div className="space-y-1 sm:min-w-[7rem]">
                        <Label className="text-[10px] text-muted-foreground">
                          Tipología
                        </Label>
                        <Select
                          value={row.typology || null}
                          onValueChange={(v) => {
                            const typology = (v ?? "") as ElementTypology | "";
                            onUpdate(row.clientId, {
                              typology,
                              elementTypeId: "",
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Tipo">
                              {row.typology ? (
                                <TypologyLabel
                                  typology={row.typology}
                                  availability={typologyImages}
                                  size="sm"
                                />
                              ) : null}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ELEMENT_TYPOLOGIES.map((t) => (
                              <SelectItem key={t} value={t}>
                                <TypologyLabel
                                  typology={t}
                                  availability={typologyImages}
                                  size="sm"
                                />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1 sm:min-w-[9rem]">
                        <Label className="text-[10px] text-muted-foreground">
                          Elemento
                        </Label>
                        <Select
                          value={row.elementTypeId || null}
                          disabled={!row.typology}
                          onValueChange={(v) => {
                            onUpdate(row.clientId, {
                              elementTypeId: v ?? "",
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Elemento">
                              {elementType?.name}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {filteredTypes.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.name}
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
                            onUpdate(row.clientId, { surfaceM2: e.target.value })
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
                            onUpdate(row.clientId, { units: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={draftRows.length === 1}
                      aria-label={`Quitar ${removeLabel} ${index + 1}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onRemove(row.clientId);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </summary>

                <div className="border-t px-3 pb-3 pt-2">
                  {!row.typology ? (
                    <p className="text-xs text-muted-foreground">
                      Elige una tipología (Tela, Bastidor o Iluminación).
                    </p>
                  ) : !row.elementTypeId ? (
                    <p className="text-xs text-muted-foreground">
                      Elige un elemento del catálogo.
                    </p>
                  ) : medida <= 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Indica la medida en m² para calcular las horas.
                    </p>
                  ) : blueprints.length === 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Este elemento no genera tareas con esa medida.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {aggregatedBlueprints.map((bp) => (
                        <li
                          key={bp.process}
                          className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-md bg-background/80"
                        >
                          <ProcessBadge
                            code={bp.process}
                            definition={processDefinition(
                              elementType!.processes,
                              bp.process,
                            )}
                          />
                          <span className="font-mono text-muted-foreground shrink-0 text-right">
                            {units > 1 ? (
                              <>
                                <span className="font-medium text-foreground">
                                  {formatHours(bp.estimatedHours)}
                                </span>
                                <span className="block text-[9px] text-muted-foreground/80">
                                  {formatHours(bp.estimatedHours / units)}/ud
                                  {" × "}
                                  {units}
                                </span>
                              </>
                            ) : (
                              formatHours(bp.estimatedHours)
                            )}
                          </span>
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
  );
}

export function draftsToElementPayload(
  parsed: ReturnType<typeof useParsedElementDrafts>,
) {
  return parsed.map(({ row, medida, units, elementType }) => ({
    typology: row.typology as ElementTypology,
    elementTypeId: row.elementTypeId,
    surfaceM2: medida,
    units,
    elementType,
  }));
}
