"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createAdHocTask } from "@/features/ad-hoc/actions";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { handleActionResult } from "@/lib/mutation-error";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface AdHocFormOptions {
  people: Array<{
    id: string;
    label: string;
    name: string;
    iniciales: string;
    naveIds: string[];
    defaultNaveId: string | null;
  }>;
  projects: Array<{ id: string; label: string }>;
  naves: Array<{ id: string; label: string }>;
  processes: Array<{ code: string; label: string }>;
}

function summarizeSelectedPeople(
  selectedIds: string[],
  people: AdHocFormOptions["people"],
): string {
  if (selectedIds.length === 0) return "Seleccionar operarios";
  if (selectedIds.length === 1) {
    return people.find((person) => person.id === selectedIds[0])?.label ?? "1 operario";
  }
  return `${selectedIds.length} operarios`;
}

export function AdHocTaskDialog({
  options,
}: {
  options: AdHocFormOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [naveId, setNaveId] = useState("");
  const [process, setProcess] = useState(IMPREVISTA_PROCESS_CODE);
  const [employeeNotes, setEmployeeNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("1");

  const visiblePeople = useMemo(() => {
    if (!naveId) return options.people;
    return options.people.filter((person) => person.naveIds.includes(naveId));
  }, [naveId, options.people]);

  const selectedProject = options.projects.find((project) => project.id === projectId);
  const selectedNave = options.naves.find((nave) => nave.id === naveId);
  const selectedProcess = options.processes.find((item) => item.code === process);

  function resetForm() {
    setEmployeeNotes("");
    setInternalNotes("");
    setPersonIds([]);
    setProjectId("");
    setNaveId("");
    setProcess(IMPREVISTA_PROCESS_CODE);
    setEstimatedHours("1");
    setPeopleOpen(false);
  }

  function togglePerson(id: string, checked: boolean) {
    setPersonIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((personId) => personId !== id);
    });
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
          Crea la imprevista con operarios y estimación. La planificación en el
          calendario se hace después desde la lista de pendientes.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (personIds.length === 0 || !projectId) return;
            if (!employeeNotes.trim() || !internalNotes.trim()) return;
            const hours = Number(estimatedHours);
            if (!Number.isFinite(hours) || hours <= 0) {
              toast.error("Indica una estimación de horas válida.");
              return;
            }
            startTransition(async () => {
              const result = await createAdHocTask({
                personIds,
                estimatedHours: hours,
                notes: employeeNotes.trim(),
                internalNotes: internalNotes.trim(),
                projectId,
                naveId: naveId || undefined,
                process: process || IMPREVISTA_PROCESS_CODE,
              });
              const outcome = handleActionResult("ad-hoc.create", result);
              if (!outcome.success) {
                toast.error(outcome.message);
                return;
              }
              toast.success(
                outcome.data.scheduledInPlanning
                  ? personIds.length === 1
                    ? "Imprevista creada y planificada en el borrador actual."
                    : `Imprevista creada y planificada para ${personIds.length} operarios.`
                  : personIds.length === 1
                    ? "Imprevista creada. Aparecerá al regenerar el planning."
                    : `Imprevista creada para ${personIds.length} operarios. Aparecerá al regenerar el planning.`,
              );
              setOpen(false);
              resetForm();
              router.refresh();
            });
          }}
        >
          <div className="space-y-2">
            <Label>Proyecto</Label>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecciona proyecto">
                  {projectId ? selectedProject?.label : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Observación para el empleado</Label>
            <Textarea
              required
              value={employeeNotes}
              onChange={(e) => setEmployeeNotes(e.target.value)}
              placeholder="Instrucciones o detalle que verá el operario"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Motivo interno (no planificado)</Label>
            <Textarea
              required
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Registro interno: por qué no estaba en la planificación"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Operarios</Label>
            <Popover open={peopleOpen} onOpenChange={setPeopleOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-between font-normal",
                      personIds.length === 0 && "text-muted-foreground",
                    )}
                  />
                }
              >
                <span className="truncate text-left">
                  {summarizeSelectedPeople(personIds, options.people)}
                </span>
                <ChevronDown className="size-4 shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--anchor-width)] p-0">
                <PopoverHeader className="border-b px-3 py-2">
                  <PopoverTitle className="text-sm">Operarios</PopoverTitle>
                </PopoverHeader>
                <div className="max-h-60 overflow-y-auto p-2">
                  {visiblePeople.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No hay operarios para la nave seleccionada.
                    </p>
                  ) : (
                    visiblePeople.map((person) => {
                      const checked = personIds.includes(person.id);
                      return (
                        <label
                          key={person.id}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) =>
                              togglePerson(person.id, next === true)
                            }
                          />
                          <span className="text-sm leading-tight">{person.label}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimated-hours">Estimación (h)</Label>
            <Input
              id="estimated-hours"
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              required
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nave</Label>
              <Select
                value={naveId}
                onValueChange={(value) => {
                  const nextNaveId = value ?? "";
                  setNaveId(nextNaveId);
                  if (!nextNaveId) return;
                  setPersonIds((current) =>
                    current.filter((id) => {
                      const person = options.people.find((item) => item.id === id);
                      return person?.naveIds.includes(nextNaveId) ?? false;
                    }),
                  );
                }}
              >
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
              disabled={
                pending ||
                personIds.length === 0 ||
                !projectId ||
                !employeeNotes.trim() ||
                !internalNotes.trim() ||
                !estimatedHours
              }
            >
              Crear imprevista
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
