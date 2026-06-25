"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createProductionOrder } from "@/features/production-orders/actions";
import { ProductionOrderKind } from "@/generated/prisma";
import { Plus } from "lucide-react";
import { toast } from "sonner";

type OrderKindTab = "proyecto" | "stock";

export function CreateOrderDialog({
  projects,
  processDefs,
  elementTypes,
  naves,
}: {
  projects: { id: string; name: string }[];
  processDefs: { code: string; label: string }[];
  elementTypes: { id: string; code: string; name: string }[];
  naves: { id: string; codigo: string; nombre: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kindTab, setKindTab] = useState<OrderKindTab>("proyecto");

  const [projectId, setProjectId] = useState("");
  const [lampLabel, setLampLabel] = useState("");
  const [process, setProcess] = useState("");
  const [hours, setHours] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");

  const [elementTypeId, setElementTypeId] = useState("");
  const [naveId, setNaveId] = useState("");
  const [stockUnits, setStockUnits] = useState("1");
  const [stockLampLabel, setStockLampLabel] = useState("");
  const [stockProcess, setStockProcess] = useState("IMPRIMACION");
  const [stockHours, setStockHours] = useState("");
  const [stockScheduledAt, setStockScheduledAt] = useState("");
  const [stockNotes, setStockNotes] = useState("");

  const resetForm = () => {
    setProjectId("");
    setLampLabel("");
    setProcess("");
    setHours("");
    setScheduledAt("");
    setNotes("");
    setElementTypeId("");
    setNaveId("");
    setStockUnits("1");
    setStockLampLabel("");
    setStockProcess("IMPRIMACION");
    setStockHours("");
    setStockScheduledAt("");
    setStockNotes("");
  };

  const submitProyecto = () => {
    if (!projectId) {
      toast.error("Selecciona proyecto");
      return;
    }
    startTransition(async () => {
      try {
        const result = await createProductionOrder({
          projectId,
          lampLabel: lampLabel || undefined,
          process: process || undefined,
          hours: hours ? Number(hours) : undefined,
          scheduledAt: scheduledAt || undefined,
          notes: notes || undefined,
          kind: ProductionOrderKind.PROYECTO,
        });
        toast.success(`Creada ${result.number}`);
        setOpen(false);
        resetForm();
        router.refresh();
        router.push(`/dashboard/ordenes/${result.id}`);
      } catch (err) {
        toast.error(reportMutationError("Error", err));
      }
    });
  };

  const submitStock = () => {
    const units = Number(stockUnits);
    if (!elementTypeId) {
      toast.error("Selecciona tipo de elemento");
      return;
    }
    if (!units || units <= 0) {
      toast.error("Indica unidades válidas");
      return;
    }
    startTransition(async () => {
      try {
        const result = await createProductionOrder({
          kind: ProductionOrderKind.STOCK,
          elementTypeId,
          naveId: naveId || undefined,
          lampLabel: stockLampLabel || undefined,
          process: stockProcess || "IMPRIMACION",
          hours: stockHours ? Number(stockHours) : undefined,
          scheduledAt: stockScheduledAt || undefined,
          notes: stockNotes || undefined,
          lines: [{ units }],
        });
        toast.success(`Creada OP stock ${result.number}`);
        setOpen(false);
        resetForm();
        router.refresh();
        router.push(`/dashboard/ordenes/${result.id}`);
      } catch (err) {
        toast.error(reportMutationError("Error", err));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <Plus className="size-4" />
        Nueva OP
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear orden de producción</DialogTitle>
        </DialogHeader>
        <Tabs
          value={kindTab}
          onValueChange={(v) => setKindTab(v as OrderKindTab)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="proyecto" className="flex-1">
              Proyecto
            </TabsTrigger>
            <TabsTrigger value="stock" className="flex-1">
              Stock anticipado
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proyecto" className="space-y-3 mt-4">
            <div className="space-y-2">
              <Label>Proyecto</Label>
              <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Lámpara / referencia</Label>
                <Input value={lampLabel} onChange={(e) => setLampLabel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Horas estimadas</Label>
                <Input
                  type="number"
                  step={0.25}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Proceso</Label>
                <Select value={process} onValueChange={(v) => setProcess(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="(opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {processDefs.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Programada</Label>
                <Input
                  type="date"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" disabled={pending} onClick={submitProyecto}>
                {pending ? "Creando…" : "Crear OP proyecto"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="stock" className="space-y-3 mt-4">
            <p className="text-xs text-muted-foreground">
              Fabricación sin proyecto. Sin RAL hasta asignar desde almacén.
            </p>
            <div className="space-y-2">
              <Label>Elemento / bastidor</Label>
              <Select value={elementTypeId} onValueChange={(v) => setElementTypeId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona elemento" />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Unidades</Label>
                <Input
                  type="number"
                  min={1}
                  className="font-mono"
                  value={stockUnits}
                  onChange={(e) => setStockUnits(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Lámpara / referencia</Label>
                <Input
                  placeholder="Cruz"
                  value={stockLampLabel}
                  onChange={(e) => setStockLampLabel(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Nave</Label>
                <Select value={naveId} onValueChange={(v) => setNaveId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="(opcional)" />
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
              <div className="space-y-2">
                <Label>Proceso inicial</Label>
                <Select value={stockProcess} onValueChange={(v) => setStockProcess(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {processDefs.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Horas estimadas</Label>
                <Input
                  type="number"
                  step={0.25}
                  value={stockHours}
                  onChange={(e) => setStockHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Programada</Label>
                <Input
                  type="date"
                  value={stockScheduledAt}
                  onChange={(e) => setStockScheduledAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                value={stockNotes}
                onChange={(e) => setStockNotes(e.target.value)}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="button" disabled={pending} onClick={submitStock}>
                {pending ? "Creando…" : "Crear OP stock"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
