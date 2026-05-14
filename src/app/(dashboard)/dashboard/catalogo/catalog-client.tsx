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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { setFrameTypeActive, upsertFrameType } from "@/features/catalog/actions";
import type { ProcessCode } from "@/generated/prisma";

interface ProcessDefOption {
  code: ProcessCode;
  label: string;
}

interface FrameProcessRow {
  id: string;
  process: ProcessCode;
  hoursPerUnit: number;
  fixedHours: number;
}

interface FrameRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  processes: FrameProcessRow[];
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
  canManage,
}: {
  frames: FrameRow[];
  processDefs: ProcessDefOption[];
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

  const activeCount = useMemo(() => frames.filter((f) => f.isActive).length, [frames]);

  function openCreate() {
    setMode("create");
    setCode("");
    setCodeLocked(false);
    setName("");
    setDescription("");
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
        await upsertFrameType({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || undefined,
          isActive: true,
          processes,
        });
        toast.success(mode === "create" ? "Bastidor creado" : "Bastidor actualizado");
        setDialogOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  function archive(frame: FrameRow) {
    if (!globalThis.confirm(`¿Archivar "${frame.name}"? No aparecerá en listas de alta de lámparas.`)) {
      return;
    }
    startTransition(async () => {
      try {
        await setFrameTypeActive({ frameTypeId: frame.id, isActive: false });
        toast.success("Bastidor archivado");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  }

  function restore(frame: FrameRow) {
    startTransition(async () => {
      try {
        await setFrameTypeActive({ frameTypeId: frame.id, isActive: true });
        toast.success("Bastidor reactivado");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  }

  return (
    <>
      <PageHeader
        title="Catálogo de bastidores"
        description={`${activeCount} activos · ${frames.length} en total · hr/m² por proceso`}
        actions={
          canManage ? (
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="size-3.5" />
              Nuevo bastidor
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
                <TableHead>Estado</TableHead>
                <TableHead>Procesos</TableHead>
                {canManage ? <TableHead className="w-[120px]" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {frames.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 5 : 4}
                    className="text-center text-muted-foreground py-6"
                  >
                    Catálogo vacío. Importa PRODUCCION.xlsx o crea un bastidor.
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
                              <ProcessBadge code={p.process} />
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
                          aria-label="Editar"
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
                            aria-label="Archivar"
                          >
                            <Trash2 className="size-3.5" />
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Nuevo bastidor" : "Editar bastidor"}
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
              <Label>Descripción (opcional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending}
                rows={2}
              />
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
                  {rows.map((r) => (
                    <div
                      key={r.key}
                      className="grid grid-cols-[1fr_72px_72px_auto] gap-2 items-end border rounded-md p-2"
                    >
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
