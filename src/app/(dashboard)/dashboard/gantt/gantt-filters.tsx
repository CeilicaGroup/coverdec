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

export interface GanttFilterPerson {
  id: string;
  iniciales: string;
  nombre: string;
}

export interface GanttFilterTaskOption {
  id: string;
  label: string;
}

export interface GanttFilterProjectOption {
  id: string;
  name: string;
}

function GanttFiltersInner({
  people,
  projectOptions,
  taskOptions,
  selectedPersonId,
  selectedTaskId,
  selectedProjectIds,
}: {
  people: GanttFilterPerson[];
  projectOptions: GanttFilterProjectOption[];
  taskOptions: GanttFilterTaskOption[];
  selectedPersonId?: string;
  selectedTaskId?: string;
  selectedProjectIds: string[];
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

  const updateParam = (key: "person" | "task", value: string | null) => {
    updateParams({ [key]: value });
  };

  const setProjectIds = (ids: string[]) => {
    updateParams({
      projects: ids.length > 0 ? ids.join(",") : null,
    });
  };

  const clearFilters = () => {
    router.push("?");
  };

  const noneSelected =
    selectedProjectIds.length === 1 && selectedProjectIds[0] === "__none__";
  const allSelected =
    !noneSelected &&
    (selectedProjectIds.length === 0 ||
      selectedProjectIds.length === projectOptions.length);
  const hasFilters = Boolean(
    selectedPersonId ||
      selectedTaskId ||
      noneSelected ||
      (selectedProjectIds.length > 0 &&
        selectedProjectIds.length < projectOptions.length),
  );

  const toggleProject = (id: string, checked: boolean) => {
    const base =
      selectedProjectIds.length === 0
        ? projectOptions.map((p) => p.id)
        : [...selectedProjectIds];
    const next = checked
      ? [...new Set([...base, id])]
      : base.filter((x) => x !== id);
    if (next.length === 0 || next.length === projectOptions.length) {
      setProjectIds([]);
    } else {
      setProjectIds(next);
    }
  };

  const selectAllProjects = () => setProjectIds([]);
  const selectNoProjects = () => {
    updateParams({ projects: "__none__" });
  };

  const projectLabel = noneSelected
    ? "Ningún proyecto"
    : selectedProjectIds.length === 0
      ? "Todos los proyectos"
      : selectedProjectIds.length === 1
        ? (projectOptions.find((p) => p.id === selectedProjectIds[0])?.name ??
          "1 proyecto")
        : `${selectedProjectIds.length} proyectos`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
        >
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
              onClick={selectAllProjects}
            >
              Todos
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={selectNoProjects}
            >
              Ninguno
            </Button>
          </div>
          <div className="max-h-56 overflow-y-auto border-t px-3 py-2 space-y-2">
            {projectOptions.map((p) => {
              const checked =
                !noneSelected &&
                (allSelected || selectedProjectIds.includes(p.id));
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

      <Select
        value={selectedPersonId ?? "__all__"}
        onValueChange={(v) => updateParam("person", v === "__all__" ? null : v)}
      >
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue placeholder="Persona" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Todas las personas</SelectItem>
          {people.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.iniciales} · {p.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={selectedTaskId ?? "__all__"}
        onValueChange={(v) => updateParam("task", v === "__all__" ? null : v)}
      >
        <SelectTrigger className="w-[200px] h-8 text-xs">
          <SelectValue placeholder="Tarea" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Todas las tareas</SelectItem>
          {taskOptions.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={clearFilters}
        >
          <X className="size-3.5" />
          Limpiar
        </Button>
      ) : null}
    </div>
  );
}

export function GanttFilters(props: {
  people: GanttFilterPerson[];
  projectOptions: GanttFilterProjectOption[];
  taskOptions: GanttFilterTaskOption[];
  selectedPersonId?: string;
  selectedTaskId?: string;
  selectedProjectIds: string[];
}) {
  return (
    <Suspense
      fallback={
        <div className="flex gap-2 h-8">
          <div className="w-[160px] rounded-md bg-muted animate-pulse" />
          <div className="w-[140px] rounded-md bg-muted animate-pulse" />
          <div className="w-[200px] rounded-md bg-muted animate-pulse" />
        </div>
      }
    >
      <GanttFiltersInner {...props} />
    </Suspense>
  );
}
