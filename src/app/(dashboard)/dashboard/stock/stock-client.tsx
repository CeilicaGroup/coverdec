"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isStockLampAssignable } from "@/features/stock/stock-assignable";
import { createStockBatch, assignLampFromStockToProject } from "@/features/stock/actions";
import { DeleteStockLampButton } from "./delete-stock-lamp-button";
import {
  isOperationCancelled,
  withSimilarLampNameConfirmation,
} from "@/features/projects/lamp-name-client";
import { formatHours, formatShortDate } from "@/lib/format";
import { toast } from "sonner";
import {
  LampElementDraftList,
  newDraftElementRow,
  useParsedElementDrafts,
  type DraftElementRow,
  type ElementTypeOption,
} from "../proyectos/[id]/lamp-element-draft-fields";
import { LampElementVisual } from "@/components/lamp-element-visual";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import { LampElementStockStatus, type ElementTypology } from "@/generated/prisma";

interface StockLampRow {
  id: string;
  name: string;
  elementTypeName: string | null;
  elementTypeId: string | null;
  elementTypology: ElementTypology | null;
  stockStatus: LampElementStockStatus | null;
  batchCodes: string[];
  pendingHours: number;
  returnedToStockAt: Date | string | null;
  returnedToStockReason: string | null;
  previousProject: { name: string; code: string } | null;
  canHardDelete: boolean;
}

const STOCK_STATUS_LABELS: Record<LampElementStockStatus, string> = {
  [LampElementStockStatus.IN_PRODUCTION]: "En producción",
  [LampElementStockStatus.AVAILABLE]: "Disponible",
  [LampElementStockStatus.ASSIGNED]: "Asignada",
};

export function StockClient({
  elementTypes,
  stockLamps,
  projects,
  typologyImages,
  elementTypeImages,
}: {
  elementTypes: ElementTypeOption[];
  stockLamps: StockLampRow[];
  projects: Array<{ id: string; name: string; code: string }>;
  stockPoolProjectId: string;
  typologyImages?: TypologyImageAvailability;
  elementTypeImages?: ElementTypeImageAvailability;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [draftRows, setDraftRows] = useState<DraftElementRow[]>([
    newDraftElementRow(),
  ]);
  const [assignLampId, setAssignLampId] = useState<string | null>(null);
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignName, setAssignName] = useState("");

  const parsed = useParsedElementDrafts(draftRows, elementTypes);
  const canSubmit =
    parsed.length > 0 &&
    parsed.every((row) => row.rowValid) &&
    name.trim().length > 0;

  const updateDraft = (clientId: string, patch: Partial<DraftElementRow>) => {
    setDraftRows((rows) =>
      rows.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)),
    );
  };

  const removeDraft = (clientId: string) => {
    setDraftRows((rows) => rows.filter((row) => row.clientId !== clientId));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lámparas en pool</CardTitle>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button className="gap-2" />}>
              <Plus className="size-4" />
              Nuevo lote
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Crear lote de stock</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  startTransition(async () => {
                    try {
                      await withSimilarLampNameConfirmation("create", async (confirmSimilarName) =>
                        createStockBatch({
                          name,
                          confirmSimilarName,
                          elements: parsed.map(({ row, medida, units }) => ({
                            typology: row.typology as ElementTypology,
                            elementTypeId: row.elementTypeId,
                            surfaceM2: medida,
                            units,
                          })),
                        }),
                      );
                      toast.success("Lote de stock creado");
                      setCreateOpen(false);
                      setName("");
                      setDraftRows([newDraftElementRow()]);
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
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <LampElementDraftList
                  draftRows={draftRows}
                  elementTypes={elementTypes}
                  typologyImages={typologyImages}
                  elementTypeImages={elementTypeImages}
                  onUpdate={updateDraft}
                  onRemove={removeDraft}
                />
                <DialogFooter>
                  <Button type="submit" disabled={pending || !canSubmit}>
                    Crear lote
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lámpara</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="w-[100px]">Editar</TableHead>
                <TableHead className="w-[48px]" />
                <TableHead className="w-[220px]">Asignar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stockLamps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No hay lámparas en el pool de stock.
                  </TableCell>
                </TableRow>
              ) : (
                stockLamps.map((lamp) => (
                  <TableRow key={lamp.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/stock/${lamp.id}`}
                        className="font-semibold text-sm hover:underline"
                      >
                        {lamp.name}
                      </Link>
                      {lamp.elementTypeId && lamp.elementTypology ? (
                        <LampElementVisual
                          label={lamp.elementTypeName}
                          typology={lamp.elementTypology}
                          typologyImages={typologyImages}
                          elementTypeId={lamp.elementTypeId}
                          elementTypeImages={elementTypeImages}
                          size="sm"
                          compact
                          className="mt-1"
                        />
                      ) : (
                        <div className="text-[10px] text-muted-foreground">
                          {lamp.elementTypeName ?? "—"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {lamp.stockStatus ? (
                        <Badge variant="outline">
                          {STOCK_STATUS_LABELS[lamp.stockStatus]}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {lamp.batchCodes.join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {lamp.previousProject ? (
                        <div>
                          <div>{lamp.previousProject.name}</div>
                          {lamp.returnedToStockAt ? (
                            <div className="text-[10px] text-muted-foreground">
                              {formatShortDate(
                                lamp.returnedToStockAt instanceof Date
                                  ? lamp.returnedToStockAt
                                  : new Date(lamp.returnedToStockAt),
                              )}
                              {lamp.returnedToStockReason
                                ? ` · ${lamp.returnedToStockReason}`
                                : ""}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        "Producción directa"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(lamp.pendingHours)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        nativeButton={false}
                        render={<Link href={`/dashboard/stock/${lamp.id}`} />}
                      >
                        <Pencil className="size-3" />
                        Editar
                      </Button>
                    </TableCell>
                    <TableCell>
                      <DeleteStockLampButton
                        lampId={lamp.id}
                        lampName={lamp.name}
                        canHardDelete={lamp.canHardDelete}
                        size="icon"
                      />
                    </TableCell>
                    <TableCell>
                      {isStockLampAssignable(lamp.stockStatus) ? (
                        <div className="flex flex-col gap-1">
                          <Select
                            value={
                              assignLampId === lamp.id ? assignProjectId : ""
                            }
                            onValueChange={(value) => {
                              setAssignLampId(lamp.id);
                              setAssignProjectId(value ?? "");
                              setAssignName(lamp.name);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Proyecto destino" />
                            </SelectTrigger>
                            <SelectContent>
                              {projects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {assignLampId === lamp.id && assignProjectId ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={pending}
                              onClick={() => {
                                startTransition(async () => {
                                  try {
                                    await withSimilarLampNameConfirmation(
                                      "create",
                                      async (confirmSimilarName) =>
                                        assignLampFromStockToProject({
                                          lampId: lamp.id,
                                          targetProjectId: assignProjectId,
                                          newName:
                                            assignName.trim() || undefined,
                                          confirmSimilarName,
                                        }),
                                    );
                                    toast.success("Lámpara asignada");
                                    setAssignLampId(null);
                                    setAssignProjectId("");
                                    router.refresh();
                                  } catch (err) {
                                    if (isOperationCancelled(err)) return;
                                    toast.error(reportMutationError("Error", err));
                                  }
                                });
                              }}
                            >
                              Asignar
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}
