"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
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
import { createAdHocTask } from "@/features/ad-hoc/actions";
import { toast } from "sonner";

export interface AdHocFormOptions {
  people: Array<{
    id: string;
    label: string;
  }>;
}

export function AdHocTaskDialog({
  options,
}: {
  options: AdHocFormOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [personId, setPersonId] = useState("");
  const [description, setDescription] = useState("");

  const selectedPersonLabel = options.people.find(
    (person) => person.id === personId,
  )?.label;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="gap-2" />}>
        <Zap className="size-4" />
        Imprevista
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea imprevista</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Tarea urgente para hoy, sin proyecto ni estimación de horas. Queda
          asignada al operario para que registre el tiempo real.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!personId || !description.trim()) return;
            startTransition(async () => {
              try {
                await createAdHocTask({
                  personId,
                  notes: description.trim(),
                });
                toast.success("Tarea imprevista creada");
                setOpen(false);
                setDescription("");
                setPersonId("");
                router.refresh();
              } catch (err) {
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qué hay que hacer"
            />
          </div>
          <div className="space-y-2">
            <Label>Operario</Label>
            <Select
              value={personId}
              onValueChange={(value) => setPersonId(value ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Operario">
                  {selectedPersonLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || !personId || !description.trim()}
            >
              Crear y asignar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
