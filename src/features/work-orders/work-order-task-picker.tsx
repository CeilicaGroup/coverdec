"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { LampElementVisual } from "@/components/lamp-element-visual";
import { getTaskLampElementVisualProps } from "@/features/planning/task-lamp-frame";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";
import {
  buildWorkOrderTaskFilterOptions,
  EMPTY_WORK_ORDER_TASK_FILTERS,
  filterWorkOrderTasks,
  type WorkOrderTaskFilterable,
  type WorkOrderTaskFilters,
} from "@/features/work-orders/filter-tasks";
import { formatHours } from "@/lib/format";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { internalProjectDisplayLabel } from "@/lib/project-kind";

function taskLabel(task: WorkOrderTaskFilterable) {
  const projectLabel = internalProjectDisplayLabel(
    task.project.kind,
    task.project.name,
  );
  if (task.process === IMPREVISTA_PROCESS_CODE) {
    const description = task.notes?.trim() || "Imprevista";
    return `${projectLabel} · ${description}`;
  }
  const element = getTaskLampElementVisualProps(task).label;
  return `${projectLabel} · ${task.lamp.name}${element ? ` · ${element}` : ""} · ${task.processDefinition.label}`;
}

export function WorkOrderTaskPicker<T extends WorkOrderTaskFilterable>({
  tasks,
  selectedIds,
  onToggle,
  processStylesByCode,
  typologyImages,
  elementTypeImages,
  emptyMessage = "No hay tareas disponibles",
}: {
  tasks: T[];
  selectedIds: string[];
  onToggle: (taskId: string) => void;
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  typologyImages?: TypologyImageAvailability;
  elementTypeImages?: ElementTypeImageAvailability;
  emptyMessage?: string;
}) {
  const [filters, setFilters] = useState<WorkOrderTaskFilters>(
    EMPTY_WORK_ORDER_TASK_FILTERS,
  );

  const options = useMemo(() => buildWorkOrderTaskFilterOptions(tasks), [tasks]);
  const filteredTasks = useMemo(
    () => filterWorkOrderTasks(tasks, filters),
    [tasks, filters],
  );

  const hasActiveFilters =
    Boolean(filters.search?.trim()) ||
    Boolean(filters.projectId) ||
    Boolean(filters.processCode) ||
    Boolean(filters.naveId) ||
    Boolean(filters.elementTypeId);

  const clearFilters = () => setFilters(EMPTY_WORK_ORDER_TASK_FILTERS);

  const updateFilter = <K extends keyof WorkOrderTaskFilters>(
    key: K,
    value: WorkOrderTaskFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar proyecto, lámpara, elemento, proceso, nave…"
            value={filters.search ?? ""}
            onChange={(e) => updateFilter("search", e.target.value)}
          />
        </div>
        <Select
          value={filters.projectId ?? ""}
          onValueChange={(v) =>
            updateFilter("projectId", typeof v === "string" && v ? v : undefined)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Proyecto" />
          </SelectTrigger>
          <SelectContent>
            {options.projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.processCode ?? ""}
          onValueChange={(v) =>
            updateFilter("processCode", typeof v === "string" && v ? v : undefined)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Proceso" />
          </SelectTrigger>
          <SelectContent>
            {options.processes.map((p) => (
              <SelectItem key={p.code} value={p.code}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.naveId ?? ""}
          onValueChange={(v) =>
            updateFilter("naveId", typeof v === "string" && v ? v : undefined)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Nave" />
          </SelectTrigger>
          <SelectContent>
            {options.naves.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.elementTypeId ?? ""}
          onValueChange={(v) =>
            updateFilter(
              "elementTypeId",
              typeof v === "string" && v ? v : undefined,
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Elemento" />
          </SelectTrigger>
          <SelectContent>
            {options.elements.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {selectedIds.length} seleccionadas · {filteredTasks.length} de{" "}
          {tasks.length} visibles
        </span>
        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        ) : null}
      </div>

      <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : filteredTasks.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Ninguna tarea coincide con los filtros
          </p>
        ) : (
          filteredTasks.map((task) => (
            <label
              key={task.id}
              className="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer"
            >
              <Checkbox
                checked={selectedIds.includes(task.id)}
                onCheckedChange={() => onToggle(task.id)}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium truncate">{taskLabel(task)}</div>
                <LampElementVisual
                  {...getTaskLampElementVisualProps(task)}
                  typologyImages={typologyImages}
                  elementTypeImages={elementTypeImages}
                  size="sm"
                  compact
                />
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{task.nave.codigo}</span>
                  <ProcessBadge
                    code={task.process}
                    definition={processStylesByCode[task.process]}
                  />
                  <span>{formatHours(task.estimatedHours)}</span>
                </div>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export { taskLabel as workOrderTaskLabel };
