"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createHoliday, deleteHoliday, updateHoliday } from "@/features/holidays/actions";
import { formatCivilIsoDate } from "@/lib/civil-date";
import { toast } from "sonner";

export interface FestivoRow {
  id: string;
  startDate: string;
  endDate: string;
  name: string;
}

function formatRange(r: FestivoRow): string {
  const a = formatCivilIsoDate(r.startDate);
  if (r.startDate === r.endDate) return a;
  const b = formatCivilIsoDate(r.endDate);
  return `${a} — ${b}`;
}

export function FestivosClient({
  rows,
  canManage,
}: {
  rows: FestivoRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [name, setName] = useState("");

  const [editing, setEditing] = useState<FestivoRow | null>(null);
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
  const [eName, setEName] = useState("");

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [rows],
  );

  function openEdit(r: FestivoRow) {
    setEditing(r);
    setEStart(r.startDate);
    setEEnd(r.endDate);
    setEName(r.name);
  }

  function submitCreate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      toast.error("Indica fechas válidas (AAAA-MM-DD)");
      return;
    }
    if (!name.trim()) {
      toast.error("Indica un nombre");
      return;
    }
    startTransition(async () => {
      const result = await createHoliday({
          startDate,
          endDate,
          name: name.trim(),
        });
      const outcome = handleActionResult("festivos.create", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success("Rango festivo guardado");
      setName("");
      setStartDate("");
      setEndDate("");
      router.refresh();
    });
  }

  function submitEdit() {
    if (!editing) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eStart) || !/^\d{4}-\d{2}-\d{2}$/.test(eEnd)) {
      toast.error("Indica fechas válidas");
      return;
    }
    if (!eName.trim()) {
      toast.error("Indica un nombre");
      return;
    }
    startTransition(async () => {
      const result = await updateHoliday({
          id: editing.id,
          startDate: eStart,
          endDate: eEnd,
          name: eName.trim(),
        });
      const outcome = handleActionResult("festivos.update", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success("Actualizado");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteHoliday({ id });
      const outcome = handleActionResult("festivos.delete", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success("Eliminado");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <div className="rounded-lg border p-4 space-y-3 max-w-lg">
          <div className="text-sm font-semibold">Nuevo rango festivo</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="festivo-start">Inicio</Label>
              <Input
                id="festivo-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="festivo-end">Fin</Label>
              <Input
                id="festivo-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="festivo-name">Nombre</Label>
              <Input
                id="festivo-name"
                placeholder="Ej. Navidad"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <Button type="button" size="sm" onClick={submitCreate} disabled={pending}>
            Guardar
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rango</TableHead>
              <TableHead>Nombre</TableHead>
              {canManage ? <TableHead className="w-28 text-right">Acciones</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canManage ? 3 : 2}
                  className="text-center text-muted-foreground py-8 text-sm"
                >
                  No hay festivos en el rango mostrado.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{formatRange(r)}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right space-x-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        aria-label="Editar"
                        onClick={() => openEdit(r)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        disabled={pending}
                        aria-label="Eliminar"
                        onClick={() => remove(r.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar festivo</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Inicio</Label>
                  <Input type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fin</Label>
                  <Input type="date" value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input value={eName} onChange={(e) => setEName(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="button" onClick={submitEdit} disabled={pending}>
                  Guardar cambios
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
