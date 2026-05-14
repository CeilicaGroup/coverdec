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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessCode } from "@/generated/prisma";
import { createTask } from "@/features/projects/actions";
import { toast } from "sonner";

export function AddTaskForm({
  projectId,
  lamps,
}: {
  projectId: string;
  lamps: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [process, setProcess] = useState<string>("");
  const [hours, setHours] = useState("");
  const [lampId, setLampId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
        <Plus className="size-3.5" />
        Tarea
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir tarea</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!process || !hours) {
              toast.error("Faltan datos");
              return;
            }
            startTransition(async () => {
              try {
                await createTask({
                  projectId,
                  lampId: lampId || undefined,
                  process: process as ProcessCode,
                  estimatedHours: Number(hours),
                });
                toast.success("Tarea añadida");
                setOpen(false);
                setProcess("");
                setHours("");
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Proceso</Label>
            <Select value={process} onValueChange={(v) => setProcess(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona proceso" />
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
            <Label>Horas estimadas</Label>
            <Input
              type="number"
              step={0.25}
              min={0.25}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>
          {lamps.length > 0 && (
            <div className="space-y-2">
              <Label>Lámpara (opcional)</Label>
              <Select value={lampId} onValueChange={(v) => setLampId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="(opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {lamps.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Añadir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
