"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../_components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProcessBadge } from "@/components/process-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHours } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Archive, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { deleteElementType, setElementTypeActive, upsertElementType } from "@/features/catalog/actions";
import type { ProcessCode } from "@/types/process";
import { getErrorMessage } from "@/lib/error-message";
import { ElementTypology } from "@/generated/prisma";
import { ELEMENT_TYPOLOGIES, ELEMENT_TYPOLOGY_LABELS } from "@/lib/element-typology";

interface ProcessDefOption {
  code: ProcessCode;
  label: string;
  bgColor: string;
  fgColor: string;
  borderColor: string;
}

interface NaveOption {
  id: string;
  codigo: string;
  nombre: string;
}

interface FrameProcessRow {
  id: string;
  process: ProcessCode;
  hoursPerUnit: number;
  fixedHours: number;
}

interface TypologyNaveRow {
  typology: ElementTypology;
  defaultNaveId: string | null;
  defaultNave: NaveOption | null;
}

interface FrameRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  typology: ElementTypology;
  isActive: boolean;
  defaultNaveId: string | null;
  defaultNave: NaveOption | null;
  processes: FrameProcessRow[];
  lampCount: number;
}

const INHERIT_TYPOLOGY_NAVALUE = "__inherit_typology__";

function naveLabel(nave: NaveOption | null): string {
  return nave ? `${nave.codigo} · ${nave.nombre}` : "—";
}

function naveSelectLabel(naveId: string, naves: NaveOption[]): string {
  if (!naveId) return "Selecciona nave";
  const nave = naves.find((item) => item.id === naveId);
  return nave ? naveLabel(nave) : "Nave";
}

function typologyNaveLabel(
  typology: ElementTypology,
  typologyNaves: TypologyNaveRow[],
): string | null {
  const row = typologyNaves.find((item) => item.typology === typology);
  return row?.defaultNave ? naveLabel(row.defaultNave) : null;
}

function CatalogNaveDisplay({
  frame,
  typologyNaves,
}: {
  frame: FrameRow;
  typologyNaves: TypologyNaveRow[];
}) {
  const typologyNave = typologyNaveLabel(frame.typology, typologyNaves);
  const inheritsTypology = frame.defaultNaveId == null;

  if (inheritsTypology) {
    return (
      <div className="space-y-0.5">
        <span className="text-xs text-muted-foreground">
          {typologyNave ?? "—"}
        </span>
        {typologyNave ? (
          <p className="text-[10px] leading-none text-muted-foreground">
            Por defecto de tipología
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <span className="text-xs text-foreground">
        {naveLabel(frame.defaultNave)}
      </span>
      <p
        className={cn(
          "text-[10px] leading-none font-medium text-amber-700 dark:text-amber-400",
        )}
      >
        Personalizada
      </p>
      {typologyNave ? (
        <p className="text-[10px] leading-none text-muted-foreground">
          Tipología: {typologyNave}
        </p>
      ) : null}
    </div>
  );
}

type DialogMode = "create" | "edit";

interface ProcessFormRow {
  key: string;
  process: ProcessCode;
  hoursPerUnit: string;
  fixedHours: string;
}

function defaultProcessRow(
  processDefs: ProcessDefOption[],
  used: Set<ProcessCode>,
): ProcessFormRow | null {
  const next = processDefs.find((d) => !used.has(d.code));
  if (!next) return null;
  return {
    key: crypto.randomUUID(),
    process: next.code,
    hoursPerUnit: "0",
    fixedHours: "0",
  };
}

export function CatalogoCatalogClient({
  frames,
  processDefs,
  naves,
  typologyNaves,
  canManage,
}: {
  frames: FrameRow[];
  processDefs: ProcessDefOption[];
  naves: NaveOption[];
  typologyNaves: TypologyNaveRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>("create");
  const [code, setCode] = useState("");
  const [codeLocked, setCodeLocked] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<ProcessFormRow[]>([]);
  const [typology, setTypology] = useState<ElementTypology>(ElementTypology.BASTIDOR);
  const [defaultNaveId, setDefaultNaveId] = useState("");

  const activeCount = useMemo(() => frames.filter((f) => f.isActive).length, [frames]);

  function openCreate() {
    setMode("create");
    setCode("");
    setCodeLocked(false);
    setName("");
    setDescription("");
    setTypology(ElementTypology.BASTIDOR);
    setDefaultNaveId("");
    const used = new Set<ProcessCode>();
    const first = defaultProcessRow(processDefs, used);
    setRows(first ? [first] : []);
    setDialogOpen(true);
  }

  function openEdit(frame: FrameRow) {
    setMode("edit");
    setCode(frame.code);
    setCodeLocked(true);
    setName(frame.name);
    setDescription(frame.description ?? "");
    setTypology(frame.typology);
    setDefaultNaveId(frame.defaultNaveId ?? "");
    setRows(
      frame.processes.length > 0
        ? frame.processes.map((p) => ({
            key: p.id,
            process: p.process,
            hoursPerUnit: String(p.hoursPerUnit),
            fixedHours: String(p.fixedHours),
          }))
        : defaultProcessRow(processDefs, new Set())
          ? [defaultProcessRow(processDefs, new Set())!]
          : [],
    );
    setDialogOpen(true);
  }

  function addRow() {
    const used = new Set(rows.map((r) => r.process));
    const row = defaultProcessRow(processDefs, used);
    if (row) setRows((prev) => [...prev, row]);
    else toast.error("No quedan procesos libres para añadir");
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRow(key: string, patch: Partial<ProcessFormRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function moveRow(key: string, direction: -1 | 1) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx < 0) return prev;
      const next = idx + direction;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  }

  function submitDialog() {
    startTransition(async () => {
      try {
        const processes = rows.map((r) => ({
          process: r.process,
          hoursPerUnit: Number(r.hoursPerUnit),
          fixedHours: Number(r.fixedHours),
        }));
        for (const r of rows) {
          if (Number.isNaN(Number(r.hoursPerUnit)) || Number(r.hoursPerUnit) < 0) {
            toast.error("Horas por unidad inválidas");
            return;
          }
          if (Number.isNaN(Number(r.fixedHours)) || Number(r.fixedHours) < 0) {
            toast.error("Horas fijas inválidas");
            return;
          }
        }
        await upsertElementType({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || undefined,
          typology,
          isActive: true,
          defaultNaveId: defaultNaveId || null,
          processes,
        });
        toast.success(mode === "create" ? "Elemento creado" : "Elemento actualizado");
        setDialogOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(getErrorMessage(e, "Error al guardar"));
      }
    });
  }

  function archive(frame: FrameRow) {
    if (!globalThis.confirm(`¿Archivar "${frame.name}"? No aparecerá en listas de alta de lámparas.`)) {
      return;
    }
    startTransition(async () => {
      try {
        await setElementTypeActive({ elementTypeId: frame.id, isActive: false });
        toast.success("Elemento archivado");
        router.refresh();
      } catch (e) {
        toast.error(getErrorMessage(e));
      }
    });
  }

  function restore(frame: FrameRow) {
    startTransition(async () => {
      try {
        await setElementTypeActive({ elementTypeId: frame.id, isActive: true });
        toast.success("Elemento reactivado");
        router.refresh();
      } catch (e) {
        toast.error(getErrorMessage(e));
      }
    });
  }

  function formatActionError(err: unknown): string {
    if (err instanceof Error && err.message.startsWith("ARCHIVE_ONLY:")) {
      return err.message.replace(/^ARCHIVE_ONLY:\s*/, "").trim();
    }
    return getErrorMessage(err);
  }

  function hardDelete(frame: FrameRow) {
    if (frame.lampCount > 0) {
      toast.error("Hay lámparas vinculadas. Solo puedes archivar el elemento.");
      return;
    }
    if (
      !globalThis.confirm(
        `¿Eliminar definitivamente el elemento «${frame.name}» (${frame.code})?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteElementType({ elementTypeId: frame.id });
        toast.success("Elemento eliminado");
        router.refresh();
      } catch (e) {
        toast.error(formatActionError(e));
      }
    });
  }

  return (
    <>
      <PageHeader
        title="Catálogo de elementos"
        description={`${activeCount} activos · ${frames.length} en total · hr/m² por proceso`}
        actions={
          canManage ? (
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="size-3.5" />
              Nuevo elemento
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipología</TableHead>
                <TableHead>Nave por defecto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Procesos</TableHead>
                {canManage ? <TableHead className="w-[152px] text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {frames.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 7 : 6}
                    className="text-center text-muted-foreground py-6"
                  >
                    Catálogo vacío. Importa PRODUCCION.xlsx o crea un elemento.
                  </TableCell>
                </TableRow>
              ) : (
                frames.map((f) => (
                  <TableRow
                    key={f.id}
                    className={!f.isActive ? "opacity-60 bg-muted/30" : undefined}
                  >
                    <TableCell className="font-mono text-xs">{f.code}</TableCell>
                    <TableCell className="font-semibold">{f.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {ELEMENT_TYPOLOGY_LABELS[f.typology]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <CatalogNaveDisplay frame={f} typologyNaves={typologyNaves} />
                    </TableCell>
                    <TableCell>
                      {f.isActive ? (
                        <Badge variant="outline">Activo</Badge>
                      ) : (
                        <Badge variant="secondary">Archivado</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {f.processes.length === 0 ? (
                          <span className="text-muted-foreground text-xs">Sin procesos</span>
                        ) : (
                          f.processes.map((p) => (
                            <span
                              key={p.id}
                              className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-[10px]"
                            >
                              <ProcessBadge
                                code={p.process}
                                definition={
                                  processDefs.find((d) => d.code === p.process) ?? {
                                    label: p.process,
                                    bgColor: "#F3F4F6",
                                    fgColor: "#374151",
                                    borderColor: "#9CA3AF",
                                  }
                                }
                              />
                              <span className="font-mono font-semibold">
                                {formatHours(p.hoursPerUnit)}/m²
                              </span>
                            </span>
                          ))
                        )}
                      </div>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right space-x-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(f)}
                          aria-label="Editar elemento"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {f.isActive ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                            onClick={() => archive(f)}
                            aria-label="Archivar elemento"
                          >
                            <Archive className="size-3.5" />
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => restore(f)}
                          >
                            Reactivar
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive disabled:opacity-40"
                          disabled={f.lampCount > 0}
                          onClick={() => hardDelete(f)}
                          title={
                            f.lampCount > 0
                              ? "Solo archivar: hay lámparas que usan este elemento"
                              : "Eliminar del todo"
                          }
                            aria-label="Eliminar elemento"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Nuevo elemento" : "Editar elemento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label>Código</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={codeLocked || pending}
                placeholder="p.ej. YPLUS"
                className="font-mono uppercase"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Tipología</Label>
              <Select
                value={typology}
                onValueChange={(v) => {
                  const next = v as ElementTypology;
                  setTypology(next);
                  if (!defaultNaveId) return;
                  const currentTypologyDefault = typologyNaveLabel(typology, typologyNaves);
                  const selectedLabel = naveSelectLabel(defaultNaveId, naves);
                  if (selectedLabel === currentTypologyDefault) {
                    setDefaultNaveId("");
                  }
                }}
                disabled={pending}
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder="Tipología"
                  >
                    {ELEMENT_TYPOLOGY_LABELS[typology]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ELEMENT_TYPOLOGIES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ELEMENT_TYPOLOGY_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Nave por defecto del catálogo</Label>
              <p className="text-[11px] text-muted-foreground">
                Por defecto hereda la nave de la tipología (
                {typologyNaveLabel(typology, typologyNaves) ?? "sin definir"}).
                Puedes fijar otra solo para este tipo de catálogo.
              </p>
              <Select
                value={defaultNaveId || INHERIT_TYPOLOGY_NAVALUE}
                onValueChange={(value) =>
                  setDefaultNaveId(
                    value === INHERIT_TYPOLOGY_NAVALUE ? "" : (value ?? ""),
                  )
                }
                disabled={pending}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecciona nave">
                    <span className="truncate">
                      {defaultNaveId
                        ? naveSelectLabel(defaultNaveId, naves)
                        : `Tipología · ${typologyNaveLabel(typology, typologyNaves) ?? "—"}`}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT_TYPOLOGY_NAVALUE}>
                    Usar tipología ·{" "}
                    {typologyNaveLabel(typology, typologyNaves) ?? "sin definir"}
                  </SelectItem>
                  {naves.map((nave) => (
                    <SelectItem key={nave.id} value={nave.id}>
                      {nave.codigo} · {nave.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Tiempos por proceso</Label>
                <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={pending}>
                  Añadir proceso
                </Button>
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin filas. Pulsa «Añadir proceso».</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((r, rowIdx) => (
                    <div
                      key={r.key}
                      className="grid grid-cols-[auto_1fr_72px_72px_auto] gap-2 items-end border rounded-md p-2"
                    >
                      <div className="flex flex-col gap-0.5 pb-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={pending || rowIdx === 0}
                          onClick={() => moveRow(r.key, -1)}
                          aria-label="Subir proceso"
                        >
                          <ChevronUp className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={pending || rowIdx === rows.length - 1}
                          onClick={() => moveRow(r.key, 1)}
                          aria-label="Bajar proceso"
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">Proceso</span>
                        <Select
                          value={r.process}
                          onValueChange={(v) =>
                            updateRow(r.key, { process: v as ProcessCode })
                          }
                          disabled={pending}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {processDefs.map((d) => (
                              <SelectItem key={d.code} value={d.code}>
                                {d.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">h/m²</span>
                        <Input
                          className="h-9 font-mono text-xs px-2"
                          inputMode="decimal"
                          value={r.hoursPerUnit}
                          onChange={(e) => updateRow(r.key, { hoursPerUnit: e.target.value })}
                          disabled={pending}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">Fijas</span>
                        <Input
                          className="h-9 font-mono text-xs px-2"
                          inputMode="decimal"
                          value={r.fixedHours}
                          onChange={(e) => updateRow(r.key, { fixedHours: e.target.value })}
                          disabled={pending}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0"
                        onClick={() => removeRow(r.key)}
                        disabled={pending}
                        aria-label="Quitar fila"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submitDialog}
              disabled={pending || !code.trim() || !name.trim()}
            >
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
