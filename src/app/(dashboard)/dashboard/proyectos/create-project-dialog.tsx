"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { createProject } from "@/features/projects/actions";
import { toast } from "sonner";

export function CreateProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [obra, setObra] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [isBillable, setIsBillable] = useState(true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <Plus className="size-4" /> Nuevo proyecto
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                const r = await createProject({
                  name,
                  client: client || undefined,
                  obra: obra || undefined,
                  deliveryDate: deliveryDate || undefined,
                  isBillable,
                });
                toast.success("Proyecto creado");
                setOpen(false);
                router.refresh();
                router.push(`/dashboard/proyectos/${r.id}`);
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Input value={client} onChange={(e) => setClient(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Obra</Label>
              <Input value={obra} onChange={(e) => setObra(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Fecha entrega</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isBillable}
              onCheckedChange={(v) => setIsBillable(v === true)}
            />
            Facturable
          </label>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
