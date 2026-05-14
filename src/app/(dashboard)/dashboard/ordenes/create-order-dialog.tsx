"use client";

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
import { ProcessCode } from "@/generated/prisma";
import { createProductionOrder } from "@/features/production-orders/actions";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export function CreateOrderDialog({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [lampLabel, setLampLabel] = useState("");
  const [process, setProcess] = useState("");
  const [hours, setHours] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <Plus className="size-4" />
        Nueva OP
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear orden de producción</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!projectId) {
              toast.error("Selecciona proyecto");
              return;
            }
            startTransition(async () => {
              try {
                const result = await createProductionOrder({
                  projectId,
                  lampLabel: lampLabel || undefined,
                  process: (process as ProcessCode) || undefined,
                  hours: hours ? Number(hours) : undefined,
                  scheduledAt: scheduledAt || undefined,
                  notes: notes || undefined,
                });
                toast.success(`Creada ${result.number}`);
                setOpen(false);
                router.refresh();
                router.push(`/dashboard/ordenes/${result.id}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            });
          }}
        >
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
                  {Object.values(ProcessCode).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
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
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
