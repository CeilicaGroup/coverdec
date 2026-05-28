"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProject } from "@/features/projects/actions";
import { toast } from "sonner";

export interface EditableProject {
  id: string;
  name: string;
  client: string | null;
  obra: string | null;
  deliveryDate: Date | null;
  isBillable: boolean;
  notes: string | null;
  responsibleUserId?: string | null;
}

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function EditProjectDialog({
  project,
  variant = "icon",
  responsibleOptions = [],
}: {
  project: EditableProject;
  variant?: "icon" | "button";
  responsibleOptions?: Array<{ id: string; name: string; role: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.client ?? "");
  const [obra, setObra] = useState(project.obra ?? "");
  const [deliveryDate, setDeliveryDate] = useState(toDateInputValue(project.deliveryDate));
  const [isBillable, setIsBillable] = useState(project.isBillable);
  const [notes, setNotes] = useState(project.notes ?? "");
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(
    project.responsibleUserId ?? null,
  );

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setClient(project.client ?? "");
    setObra(project.obra ?? "");
    setDeliveryDate(toDateInputValue(project.deliveryDate));
    setIsBillable(project.isBillable);
    setNotes(project.notes ?? "");
    setResponsibleUserId(project.responsibleUserId ?? null);
  }, [open, project]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {variant === "button" ? (
        <DialogTrigger render={<Button type="button" variant="outline" className="gap-2" />}>
          <Pencil className="size-4" />
          Editar
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              title="Editar proyecto"
              aria-label="Editar proyecto"
            />
          }
        >
          <Pencil className="size-3.5" />
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar proyecto</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                await updateProject({
                  projectId: project.id,
                  name,
                  client: client || undefined,
                  obra: obra || undefined,
                  deliveryDate: deliveryDate || undefined,
                  isBillable,
                  responsibleUserId: responsibleUserId ?? undefined,
                  notes: notes || undefined,
                });
                toast.success("Proyecto actualizado");
                setOpen(false);
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
          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <Label>Responsable del proyecto</Label>
            <Select
              value={responsibleUserId}
              onValueChange={(value) => setResponsibleUserId(value === "none" ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin responsable">
                  {responsibleUserId
                    ? (responsibleOptions.find((u) => u.id === responsibleUserId)?.name ?? "")
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin responsable</SelectItem>
                {responsibleOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isBillable}
              onCheckedChange={(v) => setIsBillable(v === true)}
            />
            Facturable
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
