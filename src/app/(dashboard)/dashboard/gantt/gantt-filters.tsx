"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function GanttFiltersInner({
  people,
  taskOptions,
  selectedPersonId,
  selectedTaskId,
}: {
  people: GanttFilterPerson[];
  taskOptions: GanttFilterTaskOption[];
  selectedPersonId?: string;
  selectedTaskId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = (key: "person" | "task", value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const search = params.toString();
    router.push(search ? `?${search}` : "?");
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("person");
    params.delete("task");
    const search = params.toString();
    router.push(search ? `?${search}` : "?");
  };

  const hasFilters = Boolean(selectedPersonId || selectedTaskId);

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
          <X className="size-3.5" />
          Limpiar
        </Button>
      ) : null}
    </div>
  );
}

export function GanttFilters(props: {
  people: GanttFilterPerson[];
  taskOptions: GanttFilterTaskOption[];
  selectedPersonId?: string;
  selectedTaskId?: string;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex gap-2 h-8">
          <div className="w-[140px] rounded-md bg-muted animate-pulse" />
          <div className="w-[200px] rounded-md bg-muted animate-pulse" />
        </div>
      }
    >
      <GanttFiltersInner {...props} />
    </Suspense>
  );
}
