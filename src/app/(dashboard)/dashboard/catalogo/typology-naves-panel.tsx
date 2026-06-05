"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { updateTypologyDefaultNave } from "@/features/catalog/actions";
import { ElementTypology } from "@/generated/prisma";
import {
  ELEMENT_TYPOLOGIES,
  ELEMENT_TYPOLOGY_LABELS,
} from "@/lib/element-typology";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";

interface NaveOption {
  id: string;
  codigo: string;
  nombre: string;
}

interface TypologyNaveRow {
  typology: ElementTypology;
  defaultNaveId: string | null;
  defaultNave: NaveOption | null;
}

function naveLabel(nave: NaveOption | null): string {
  return nave ? `${nave.codigo} · ${nave.nombre}` : "—";
}

function naveSelectLabel(naveId: string, naves: NaveOption[]): string {
  if (!naveId) return "Selecciona nave";
  const nave = naves.find((item) => item.id === naveId);
  return nave ? naveLabel(nave) : "Nave";
}

export function TypologyNavesPanel({
  rows,
  naves,
  canManage,
}: {
  rows: TypologyNaveRow[];
  naves: NaveOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<TypologyNaveRow | null>(null);
  const [selectedNaveId, setSelectedNaveId] = useState("");

  const rowsByTypology = new Map(rows.map((row) => [row.typology, row]));

  function openEdit(typology: ElementTypology) {
    const row = rowsByTypology.get(typology);
    setEditing({
      typology,
      defaultNaveId: row?.defaultNaveId ?? null,
      defaultNave: row?.defaultNave ?? null,
    });
    setSelectedNaveId(row?.defaultNaveId ?? naves[0]?.id ?? "");
  }

  function submitEdit() {
    if (!editing) return;
    startTransition(async () => {
      try {
        await updateTypologyDefaultNave({
          typology: editing.typology,
          defaultNaveId: selectedNaveId || null,
        });
        toast.success("Nave de tipología actualizada");
        setEditing(null);
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Naves por tipología</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Tela, bastidor e iluminación definen la nave por defecto al crear
          elementos. Cada tipo de catálogo puede sobrescribirla; cada lámpara
          puede personalizarla después.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipología</TableHead>
              <TableHead>Nave por defecto</TableHead>
              {canManage ? <TableHead className="w-20 text-right">Acciones</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ELEMENT_TYPOLOGIES.map((typology) => {
              const row = rowsByTypology.get(typology);
              return (
                <TableRow key={typology}>
                  <TableCell className="font-medium">
                    {ELEMENT_TYPOLOGY_LABELS[typology]}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {naveLabel(row?.defaultNave ?? null)}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(typology)}
                        aria-label={`Editar nave de ${ELEMENT_TYPOLOGY_LABELS[typology]}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? `Nave por defecto · ${ELEMENT_TYPOLOGY_LABELS[editing.typology]}`
                : "Nave por defecto"}
            </DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Los nuevos elementos de esta tipología usarán esta nave al crear
                tareas, salvo que el tipo de catálogo o la lámpara indiquen otra.
              </p>
              <div className="space-y-2">
                <Label>Nave</Label>
                <Select
                  value={selectedNaveId || null}
                  onValueChange={(value) => setSelectedNaveId(value ?? "")}
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona nave">
                      <span className="truncate">
                        {naveSelectLabel(selectedNaveId, naves)}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {naves.map((nave) => (
                      <SelectItem key={nave.id} value={nave.id}>
                        {nave.codigo} · {nave.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" onClick={submitEdit} disabled={pending || !selectedNaveId}>
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
