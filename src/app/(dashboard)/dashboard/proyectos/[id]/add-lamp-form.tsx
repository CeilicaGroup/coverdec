"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";

interface FrameTypeOption {
  id: string;
  name: string;
  processes: (ProcessBadgeStyle & { process: string })[];
}

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
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
  const [surfaceM2, setSurfaceM2] = useState("");
  const [units, setUnits] = useState("1");
  const [frameTypeId, setFrameTypeId] = useState("");
  const [naveId, setNaveId] = useState(defaultNaveId ?? "");

  const selectedFrameType = frameTypes.find((f) => f.id === frameTypeId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
        <Plus className="size-3.5" />
        Lámpara
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir lámpara</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!naveId) {
              toast.error("Selecciona una nave");
              return;
            }
            if (!frameTypeId) {
              toast.error("Selecciona un tipo de bastidor");
              return;
            }
            const medida = Number(surfaceM2);
            if (!medida || medida <= 0) {
              toast.error("Indica la medida");
              return;
            }
            startTransition(async () => {
              try {
                await createLamp({
                  projectId,
                  name,
                  frameTypeId,
                  surfaceM2: medida,
                  units: Number(units) || 1,
                  naveId,
                });
                toast.success("Lámpara y tareas creadas");
                setOpen(false);
                setName("");
                setSurfaceM2("");
                setFrameTypeId("");
                setNaveId(defaultNaveId ?? "");
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Nombre</Label>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Medida</Label>
              <Input
                type="number"
                step={0.01}
                min={0.01}
                required
                value={surfaceM2}
                onChange={(e) => setSurfaceM2(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Unidades</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tipo de bastidor</Label>
            <Select
              value={frameTypeId}
              onValueChange={(v) => setFrameTypeId(v ?? "")}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona bastidor">
                  {frameTypeId ? (frameTypes.find((f) => f.id === frameTypeId)?.name ?? "") : undefined}
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
            {selectedFrameType && selectedFrameType.processes.length > 0 ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {selectedFrameType.processes.map((p) => (
                  <ProcessBadge
                    key={p.process}
                    code={p.process}
                    definition={{ label: p.label, bgColor: p.bgColor, fgColor: p.fgColor, borderColor: p.borderColor }}
                  />
                ))}
              </div>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              El bastidor no se puede cambiar después; para otro tipo, borra la lámpara y créala de nuevo.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || frameTypes.length === 0}>
              Añadir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
