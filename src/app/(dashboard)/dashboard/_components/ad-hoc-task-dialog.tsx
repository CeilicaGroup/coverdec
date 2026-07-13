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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAdHocTask } from "@/features/ad-hoc/actions";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { toast } from "sonner";

export interface AdHocFormOptions {
  people: Array<{
    id: string;
    label: string;
    defaultNaveId: string | null;
  }>;
  projects: Array<{ id: string; label: string }>;
  naves: Array<{ id: string; label: string }>;
  processes: Array<{ code: string; label: string }>;
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
  const [projectId, setProjectId] = useState("");
  const [naveId, setNaveId] = useState("");
  const [process, setProcess] = useState(IMPREVISTA_PROCESS_CODE);
  const [description, setDescription] = useState("");

  const selectedPerson = options.people.find((person) => person.id === personId);
  const selectedProject = options.projects.find((project) => project.id === projectId);
  const selectedNave = options.naves.find((nave) => nave.id === naveId);
  const selectedProcess = options.processes.find((item) => item.code === process);

  function resetForm() {
    setDescription("");
    setPersonId("");
    setProjectId("");
    setNaveId("");
    setProcess(IMPREVISTA_PROCESS_CODE);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger render={<Button variant="outline" className="gap-2" />}>
        <Zap className="size-4" />
        Imprevista
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva tarea imprevista</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Tarea urgente para hoy. Indica proyecto, nave y proceso para el
          análisis de desviaciones.
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
                  projectId: projectId || undefined,
                  naveId: naveId || selectedPerson?.defaultNaveId || undefined,
                  process: process || IMPREVISTA_PROCESS_CODE,
                });
                toast.success("Tarea imprevista creada");
                setOpen(false);
                resetForm();
                router.refresh();
              } catch (err) {
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Observación</Label>
            <Textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Motivo y descripción del imprevisto"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Operario</Label>
            <Select
              value={personId}
              onValueChange={(value) => {
                setPersonId(value ?? "");
                const person = options.people.find((p) => p.id === value);
                if (person?.defaultNaveId) setNaveId(person.defaultNaveId);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Operario">
                  {selectedPerson?.label}
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
          <div className="space-y-2">
            <Label>Proyecto (opcional)</Label>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin proyecto concreto">
                  {projectId ? selectedProject?.label : "Sin proyecto"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin proyecto</SelectItem>
                {options.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nave</Label>
              <Select value={naveId} onValueChange={(v) => setNaveId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Nave">
                    {selectedNave?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options.naves.map((nave) => (
                    <SelectItem key={nave.id} value={nave.id}>
                      {nave.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Proceso</Label>
              <Select value={process} onValueChange={(v) => setProcess(v ?? IMPREVISTA_PROCESS_CODE)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Proceso">
                    {selectedProcess?.label ?? process}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options.processes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
