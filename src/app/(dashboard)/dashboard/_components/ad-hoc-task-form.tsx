"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
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
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { cn } from "@/lib/utils";

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

export interface AdHocTaskFormValues {
  projectId: string;
  employeeNotes: string;
  internalNotes: string;
  personIds: string[];
  estimatedHours: string;
  naveId: string;
  process: string;
}

export interface AdHocTaskFormLockedFields {
  structural?: boolean;
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

export function AdHocTaskForm({
  options,
  initialValues,
  lockedFields,
  submitLabel,
  pending,
  onSubmit,
}: {
  options: AdHocFormOptions;
  initialValues?: Partial<AdHocTaskFormValues>;
  lockedFields?: AdHocTaskFormLockedFields;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: AdHocTaskFormValues) => void;
}) {
  const structuralLocked = lockedFields?.structural ?? false;
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [personIds, setPersonIds] = useState<string[]>(initialValues?.personIds ?? []);
  const [projectId, setProjectId] = useState(initialValues?.projectId ?? "");
  const [naveId, setNaveId] = useState(initialValues?.naveId ?? "");
  const [process, setProcess] = useState(initialValues?.process ?? IMPREVISTA_PROCESS_CODE);
  const [employeeNotes, setEmployeeNotes] = useState(initialValues?.employeeNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(initialValues?.internalNotes ?? "");
  const [estimatedHours, setEstimatedHours] = useState(initialValues?.estimatedHours ?? "1");

  const visiblePeople = useMemo(() => {
    if (!naveId) return options.people;
    return options.people.filter((person) => person.naveIds.includes(naveId));
  }, [naveId, options.people]);

  const selectedProject = options.projects.find((project) => project.id === projectId);
  const selectedNave = options.naves.find((nave) => nave.id === naveId);
  const selectedProcess = options.processes.find((item) => item.code === process);

  function togglePerson(id: string, checked: boolean) {
    setPersonIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((personId) => personId !== id);
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          projectId,
          employeeNotes,
          internalNotes,
          personIds,
          estimatedHours,
          naveId,
          process,
        });
      }}
    >
      {structuralLocked ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Esta imprevista tiene horas fichadas: solo puedes cambiar las observaciones.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label>Proyecto</Label>
        <Select
          value={projectId}
          onValueChange={(v) => setProjectId(v ?? "")}
          disabled={structuralLocked}
        >
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
                disabled={structuralLocked}
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
                        disabled={structuralLocked}
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
          required={!structuralLocked}
          disabled={structuralLocked}
          value={estimatedHours}
          onChange={(e) => setEstimatedHours(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Nave</Label>
          <Select
            value={naveId}
            disabled={structuralLocked}
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
          <Select
            value={process}
            disabled={structuralLocked}
            onValueChange={(v) => setProcess(v ?? IMPREVISTA_PROCESS_CODE)}
          >
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
            !employeeNotes.trim() ||
            !internalNotes.trim() ||
            (!structuralLocked &&
              (personIds.length === 0 || !projectId || !estimatedHours))
          }
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
