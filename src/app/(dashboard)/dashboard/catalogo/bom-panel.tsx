"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { deleteBomComponent, upsertBomComponent } from "@/features/catalog/actions";
import { formatEuros } from "@/lib/format";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import { computeMaterialCostPerUnit } from "@/features/costes/bom-cost";

export interface BomRow {
  id: string;
  elementTypeId: string;
  componentCode: string;
  name: string;
  quantity: number;
  unitCost: number;
}

export interface ElementTypeBomOption {
  id: string;
  code: string;
  name: string;
}

export function BomPanel({
  elementTypes,
  bomRows,
  canManage,
}: {
  elementTypes: ElementTypeBomOption[];
  bomRows: BomRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [elementTypeId, setElementTypeId] = useState(elementTypes[0]?.id ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BomRow | null>(null);
  const [componentCode, setComponentCode] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("0");

  const filtered = bomRows.filter((row) => row.elementTypeId === elementTypeId);
  const selectedType = elementTypes.find((et) => et.id === elementTypeId);
  const unitMaterial = computeMaterialCostPerUnit(
    filtered.map((row) => ({ quantity: row.quantity, unitCost: row.unitCost })),
  );

  function openCreate() {
    setEditing(null);
    setComponentCode("");
    setName("");
    setQuantity("1");
    setUnitCost("0");
    setDialogOpen(true);
  }

  function openEdit(row: BomRow) {
    setEditing(row);
    setComponentCode(row.componentCode);
    setName(row.name);
    setQuantity(String(row.quantity));
    setUnitCost(String(row.unitCost));
    setDialogOpen(true);
  }

  function save() {
    if (!elementTypeId) return;
    startTransition(async () => {
      try {
        await upsertBomComponent({
          elementTypeId,
          componentCode: componentCode.trim(),
          name: name.trim(),
          quantity: Number(quantity),
          unitCost: Number(unitCost),
        });
        toast.success(editing ? "Componente actualizado" : "Componente añadido");
        setDialogOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
    });
  }

  function remove(row: BomRow) {
    if (!globalThis.confirm(`¿Eliminar ${row.componentCode}?`)) return;
    startTransition(async () => {
      try {
        await deleteBomComponent({ id: row.id });
        toast.success("Componente eliminado");
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
    });
  }

  if (elementTypes.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>BOM por lámpara</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Material estándar por unidad fabricada (Fase E)
          </p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" onClick={openCreate} disabled={!elementTypeId || pending}>
            <Plus className="size-3.5 mr-1" />
            Añadir
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[220px]">
            <Label className="text-xs">Tipo de elemento</Label>
            <Select value={elementTypeId} onValueChange={(v) => setElementTypeId(v ?? "")}>
              <SelectTrigger className="h-9">
                <SelectValue>
                  {selectedType ? `${selectedType.code} · ${selectedType.name}` : "Selecciona"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {elementTypes.map((et) => (
                  <SelectItem key={et.id} value={et.id}>
                    {et.code} · {et.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground pb-1">
            Material/u:{" "}
            <span className="font-mono font-bold text-foreground">{formatEuros(unitMaterial)}</span>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead>€/ud</TableHead>
              <TableHead>Subtotal/u</TableHead>
              {canManage ? <TableHead className="w-[88px]" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground py-4">
                  Sin componentes BOM para este tipo.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.componentCode}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="font-mono">{row.quantity}</TableCell>
                  <TableCell className="font-mono">{formatEuros(row.unitCost)}</TableCell>
                  <TableCell className="font-mono">
                    {formatEuros(row.quantity * row.unitCost)}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right space-x-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(row)}
                        aria-label="Editar componente"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={() => remove(row)}
                        aria-label="Eliminar componente"
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar componente" : "Nuevo componente BOM"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Código</Label>
              <Input
                value={componentCode}
                onChange={(e) => setComponentCode(e.target.value)}
                disabled={Boolean(editing) || pending}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Cantidad / ud fabricada</Label>
                <Input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={pending}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label>Coste unitario (€)</Label>
                <Input
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  disabled={pending}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
