"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createProcessDefinition,
  deleteProcessDefinition,
  updateProcessDefinition,
} from "@/features/catalog/actions";
import { deriveProcessColors } from "@/lib/color";
import { PROCESS_CODE_PATTERN } from "@/types/process";
import { toast } from "sonner";

export interface ProcessRow {
  code: string;
  label: string;
  waitHours: number;
  bgColor: string;
  fgColor: string;
  borderColor: string;
  canFragment: boolean;
}

function toBadgeStyle(p: ProcessRow): ProcessBadgeStyle {
  return {
    label: p.label,
    bgColor: p.bgColor,
    fgColor: p.fgColor,
    borderColor: p.borderColor,
  };
}

export function ProcessDefinitionsPanel({
  processes,
  canManage,
}: {
  processes: ProcessRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [cCode, setCCode] = useState("");
  const [cLabel, setCLabel] = useState("");
  const [cWait, setCWait] = useState("0");

  const [editing, setEditing] = useState<ProcessRow | null>(null);
  const [eWait, setEWait] = useState("");
  const [eLabel, setELabel] = useState("");
  const [eColor, setEColor] = useState("#64748b");
  const [eCanFragment, setECanFragment] = useState(true);

  function openEdit(row: ProcessRow) {
    setEditing(row);
    setEWait(String(row.waitHours));
    setELabel(row.label);
    setEColor(row.fgColor.startsWith("#") && row.fgColor.length === 7 ? row.fgColor : "#64748b");
    setECanFragment(row.canFragment);
  }

  function submitCreate() {
    const wh = Number(cWait);
    if (!PROCESS_CODE_PATTERN.test(cCode.trim())) {
      toast.error("Código: mayúsculas, números y _ (ej. MI_PROCESO)");
      return;
    }
    if (!cLabel.trim()) {
      toast.error("Indica etiqueta");
      return;
    }
    if (Number.isNaN(wh) || wh < 0) {
      toast.error("Horas de espera inválidas");
      return;
    }
    startTransition(async () => {
      try {
        await createProcessDefinition({
          code: cCode.trim(),
          label: cLabel.trim(),
          waitHours: wh,
        });
        toast.success("Proceso creado");
        setCreateOpen(false);
        setCCode("");
        setCLabel("");
        setCWait("0");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function submitEdit() {
    if (!editing) return;
    const wh = Number(eWait);
    if (Number.isNaN(wh) || wh < 0) {
      toast.error("Horas de espera inválidas");
      return;
    }
    if (!eLabel.trim()) {
      toast.error("Indica etiqueta");
      return;
    }
    startTransition(async () => {
      try {
        const colors = deriveProcessColors(eColor);
        await updateProcessDefinition({
          code: editing.code,
          waitHours: wh,
          label: eLabel.trim(),
          bgColor: colors.bgColor,
          fgColor: colors.fgColor,
          borderColor: colors.borderColor,
          canFragment: eCanFragment,
        });
        toast.success("Proceso actualizado");
        setEditing(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function remove(row: ProcessRow) {
    if (!confirm(`¿Eliminar el proceso «${row.label}» (${row.code})?`)) return;
    startTransition(async () => {
      try {
        await deleteProcessDefinition({ code: row.code });
        toast.success("Proceso eliminado");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Procesos de producción</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Catálogo global: espera entre procesos, orden y estilo. Los bastidores referencian estos códigos.
          </p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Nuevo proceso
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proceso</TableHead>
              <TableHead className="text-right">Espera (h)</TableHead>
              {canManage ? <TableHead className="w-28 text-right">Acciones</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {processes.map((p) => (
              <TableRow key={p.code}>
                <TableCell>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ProcessBadge code={p.code} definition={toBadgeStyle(p)} />
                    <span className="text-[10px] font-mono text-muted-foreground">{p.code}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {p.waitHours > 0 ? p.waitHours : "—"}
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right space-x-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEdit(p)}
                      aria-label={`Editar ${p.label}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      onClick={() => remove(p)}
                      aria-label={`Eliminar ${p.label}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo proceso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Código (único)</Label>
              <Input
                placeholder="EJEMPLO_PROCESO"
                value={cCode}
                onChange={(e) => setCCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label>Etiqueta</Label>
              <Input value={cLabel} onChange={(e) => setCLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Horas de espera (secado)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={cWait}
                onChange={(e) => setCWait(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={submitCreate} disabled={pending}>
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar proceso</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Etiqueta</Label>
                <Input value={eLabel} onChange={(e) => setELabel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Horas de espera (secado)</Label>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  step={0.5}
                  value={eWait}
                  onChange={(e) => setEWait(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex items-center gap-3">
                  <label
                    className="relative flex items-center justify-center w-9 h-9 rounded-md border cursor-pointer overflow-hidden"
                    style={{ background: eColor }}
                  >
                    <input
                      type="color"
                      value={eColor}
                      onChange={(e) => setEColor(e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                  </label>
                  <ProcessBadge
                    code={editing.code}
                    definition={{ ...deriveProcessColors(eColor), label: eLabel || editing.label }}
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!eCanFragment}
                  onChange={(e) => setECanFragment(!e.target.checked)}
                />
                <span className="space-y-0.5">
                  <span className="text-sm font-medium leading-none">No fragmentar</span>
                  <span className="block text-xs text-muted-foreground">
                    Las tareas de este proceso se asignan en un único bloque sin dividir entre días.
                  </span>
                </span>
              </label>
              <DialogFooter>
                <Button type="button" onClick={submitEdit} disabled={pending}>
                  Guardar
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
