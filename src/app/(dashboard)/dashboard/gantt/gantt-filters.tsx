"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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

export type GanttAxisMode = "project" | "worker";

export interface GanttFilterPerson {
  id: string;
  iniciales: string;
  nombre: string;
}

export interface GanttFilterProjectOption {
  id: string;
  name: string;
}

function parseSelectedIds(ids: string[], allIds: string[]): {
  noneSelected: boolean;
  allSelected: boolean;
} {
  const noneSelected = ids.length === 1 && ids[0] === "__none__";
  const allSelected =
    !noneSelected && (ids.length === 0 || ids.length === allIds.length);
  return { noneSelected, allSelected };
}

function GanttFiltersInner({
  axisMode,
  people,
  projectOptions,
  selectedProjectIds,
  selectedPersonIds,
}: {
  axisMode: GanttAxisMode;
  people: GanttFilterPerson[];
  projectOptions: GanttFilterProjectOption[];
  selectedProjectIds: string[];
  selectedPersonIds: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const search = params.toString();
    router.push(search ? `?${search}` : "?");
  };

  const setAxisMode = (nextMode: GanttAxisMode) => {
    updateParams({
      axis: nextMode,
      people: nextMode === "worker" ? (selectedPersonIds.join(",") || null) : null,
    });
  };

  const setProjectIds = (ids: string[]) => {
    updateParams({
      projects: ids.length > 0 ? ids.join(",") : null,
    });
  };

  const setPersonIds = (ids: string[]) => {
    updateParams({
      people: ids.length > 0 ? ids.join(",") : null,
    });
  };

  const clearFilters = () => {
    updateParams({
      projects: null,
      people: null,
    });
  };

  const { noneSelected: noProjects, allSelected: allProjects } = parseSelectedIds(
    selectedProjectIds,
    projectOptions.map((p) => p.id),
  );
  const { noneSelected: noPeople, allSelected: allPeople } = parseSelectedIds(
    selectedPersonIds,
    people.map((p) => p.id),
  );

  const hasFilters = Boolean(
    noProjects ||
      (selectedProjectIds.length > 0 &&
        selectedProjectIds.length < projectOptions.length) ||
      (axisMode === "worker" &&
        (noPeople ||
          (selectedPersonIds.length > 0 && selectedPersonIds.length < people.length))),
  );

  const toggleProject = (id: string, checked: boolean) => {
    const base =
      selectedProjectIds.length === 0
        ? projectOptions.map((p) => p.id)
        : selectedProjectIds.filter((p) => p !== "__none__");
    const next = checked
      ? [...new Set([...base, id])]
      : base.filter((x) => x !== id);
    if (next.length === 0 || next.length === projectOptions.length) {
      setProjectIds([]);
    } else {
      setProjectIds(next);
    }
  };

  const togglePerson = (id: string, checked: boolean) => {
    const base =
      selectedPersonIds.length === 0
        ? people.map((p) => p.id)
        : selectedPersonIds.filter((p) => p !== "__none__");
    const next = checked
      ? [...new Set([...base, id])]
      : base.filter((x) => x !== id);
    if (next.length === 0 || next.length === people.length) {
      setPersonIds([]);
    } else {
      setPersonIds(next);
    }
  };

  const projectLabel = noProjects
    ? "Ningún proyecto"
    : selectedProjectIds.length === 0
      ? "Todos los proyectos"
      : `${selectedProjectIds.length} proyectos`;

  const peopleLabel = noPeople
    ? "Ningún trabajador"
    : selectedPersonIds.length === 0
      ? "Todos los trabajadores"
      : `${selectedPersonIds.length} trabajadores`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={axisMode} onValueChange={(v) => setAxisMode(v as GanttAxisMode)}>
        <SelectTrigger className="w-[210px] h-8 text-xs">
          <SelectValue placeholder="Eje" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="project">Proyecto / Tareas</SelectItem>
          <SelectItem value="worker">Trabajador / Tareas</SelectItem>
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
          <Filter className="size-3.5" />
          {projectLabel}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <PopoverHeader className="px-3 pt-3">
            <PopoverTitle className="text-sm">Proyectos</PopoverTitle>
          </PopoverHeader>
          <div className="flex gap-2 px-3 pb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={() => setProjectIds([])}
            >
              Todos
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={() => updateParams({ projects: "__none__" })}
            >
              Ninguno
            </Button>
          </div>
          <div className="max-h-56 overflow-y-auto border-t px-3 py-2 space-y-2">
            {projectOptions.map((p) => {
              const checked = !noProjects && (allProjects || selectedProjectIds.includes(p.id));
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`gantt-project-${p.id}`}
                    checked={checked}
                    onCheckedChange={(v) => toggleProject(p.id, v === true)}
                  />
                  <Label
                    htmlFor={`gantt-project-${p.id}`}
                    className="text-xs font-normal cursor-pointer truncate"
                  >
                    {p.name}
                  </Label>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {axisMode === "worker" ? (
        <Popover>
          <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
            <Filter className="size-3.5" />
            {peopleLabel}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <PopoverHeader className="px-3 pt-3">
              <PopoverTitle className="text-sm">Trabajadores</PopoverTitle>
            </PopoverHeader>
            <div className="flex gap-2 px-3 pb-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={() => setPersonIds([])}
              >
                Todos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={() => updateParams({ people: "__none__" })}
              >
                Ninguno
              </Button>
            </div>
            <div className="max-h-56 overflow-y-auto border-t px-3 py-2 space-y-2">
              {people.map((p) => {
                const checked = !noPeople && (allPeople || selectedPersonIds.includes(p.id));
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`gantt-person-${p.id}`}
                      checked={checked}
                      onCheckedChange={(v) => togglePerson(p.id, v === true)}
                    />
                    <Label
                      htmlFor={`gantt-person-${p.id}`}
                      className="text-xs font-normal cursor-pointer truncate"
                    >
                      {p.iniciales} · {p.nombre}
                    </Label>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      {hasFilters ? (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
          <X className="size-3.5" />
          Limpiar
        </Button>
      ) : null}
    </div>
  );
}

export function GanttFilters(props: {
  axisMode: GanttAxisMode;
  people: GanttFilterPerson[];
  projectOptions: GanttFilterProjectOption[];
  selectedProjectIds: string[];
  selectedPersonIds: string[];
}) {
  return (
    <Suspense
      fallback={
        <div className="flex gap-2 h-8">
          <div className="w-[210px] rounded-md bg-muted animate-pulse" />
          <div className="w-[170px] rounded-md bg-muted animate-pulse" />
        </div>
      }
    >
      <GanttFiltersInner {...props} />
    </Suspense>
  );
}
