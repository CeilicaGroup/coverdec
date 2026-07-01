"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { WorkOrderBadge } from "@/components/work-order-badge";
import { withWorkOrderHighlight } from "@/features/work-orders/highlight";
import { formatHours } from "@/lib/format";
import type { ProcessCode } from "@/types/process";
import {
  aggregateTasksByProcess,
  dryWaitHoursForProcess,
  groupTasksByBastidor,
  type TaskHoursAggregate,
} from "@/features/projects/lamp-tasks";
import {
  addExtraTask,
  applyDefaultNavesToElement,
  assignElementTasksNave,
  assignProcessTasksNave,
  deleteProcessTasks,
  deleteTask,
  reorderTask,
  updateTaskHours,
  updateTaskNave,
  updateTaskNotes,
} from "@/features/projects/actions";
import {
  describeNaveAssignment,
  formatNaveLabel,
  MANUAL_ELEMENT_KEY,
  summarizeNaveIds,
  type NaveAssignmentKind,
  type NaveSummary,
} from "@/features/projects/task-nave";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface LampTaskRow {
  id: string;
  process: ProcessCode;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  order: number;
  notes: string | null;
  naveId: string;
  nave: NaveSummary | null;
  lampElement:
    | {
        id: string;
        label: string | null;
        surfaceM2: number | null;
        elementType: { id: string; name: string };
      }
    | null;
  workOrder: { number: string; status: import("@/generated/prisma").WorkOrderStatus } | null;
}

type TaskViewMode = "agrupada" | "detalle";

function bastidorSummaryLabel(
  frameTypeName: string,
  unitCount: number,
  surfaceM2: number | null,
): string {
  const parts = [frameTypeName];
  if (surfaceM2 != null) parts.push(`${surfaceM2} m²`);
  if (unitCount > 1) parts.push(`${unitCount} uds`);
  return parts.join(" · ");
}

function navePickerLabel(
  naveId: string,
  navesById: Map<string, NaveSummary>,
): string {
  if (!naveId) return "Selecciona nave";
  const nave = navesById.get(naveId);
  return nave ? formatNaveLabel(nave, naveId) : "Nave";
}

function defaultNaveLabelForGroup(
  groupKey: string,
  elementTypeDefaultNaves: Record<string, string | null>,
  navesById: Map<string, NaveSummary>,
): string | null {
  if (groupKey === MANUAL_ELEMENT_KEY) return null;
  const defaultNaveId = elementTypeDefaultNaves[groupKey];
  if (!defaultNaveId) return null;
  return formatNaveLabel(navesById.get(defaultNaveId), defaultNaveId);
}

function naveAssignmentHintLabel(kind: NaveAssignmentKind): string | null {
  switch (kind) {
    case "default":
      return "Por defecto del tipo";
    case "custom":
      return "Personalizada";
    case "mixed":
      return "Mixto";
    default:
      return null;
  }
}

function NaveAssignmentHint({ kind }: { kind: NaveAssignmentKind }) {
  const label = naveAssignmentHintLabel(kind);
  if (!label) return null;

  return (
    <span
      className={cn(
        "text-[10px] leading-none",
        kind === "default"
          ? "text-muted-foreground"
          : "font-medium text-amber-700 dark:text-amber-400",
      )}
    >
      {label}
    </span>
  );
}

function NaveCell({
  naveId,
  defaultNaveId,
  naves,
  navesById,
  assignmentKind,
  disabled,
  onChange,
}: {
  naveId: string;
  defaultNaveId: string | null | undefined;
  naves: NaveSummary[];
  navesById: Map<string, NaveSummary>;
  assignmentKind: NaveAssignmentKind;
  disabled?: boolean;
  onChange: (naveId: string) => void;
}) {
  return (
    <div className="space-y-0.5 min-w-[8.5rem]">
      <NavePicker
        value={naveId}
        naves={naves}
        navesById={navesById}
        disabled={disabled}
        className="w-full"
        onChange={onChange}
      />
      {defaultNaveId ? <NaveAssignmentHint kind={assignmentKind} /> : null}
    </div>
  );
}

function NavePicker({
  value,
  naves,
  navesById,
  onChange,
  disabled,
  className,
}: {
  value: string;
  naves: NaveSummary[];
  navesById: Map<string, NaveSummary>;
  onChange: (naveId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const label = navePickerLabel(value, navesById);

  return (
    <Select
      value={value || null}
      onValueChange={(next) => onChange(next ?? "")}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-7 text-xs max-w-full", className)}>
        <SelectValue placeholder="Nave">
          <span className="truncate">{label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {naves.map((nave) => (
          <SelectItem key={nave.id} value={nave.id}>
            {nave.codigo} · {nave.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ElementSectionBar({
  label,
  showLabel,
  typeDefaultNaveLabel,
  groupNaveKind,
  canManage,
  canAddExtra,
  showAssignNave,
  onAssignNave,
  onAddExtra,
}: {
  label: string;
  showLabel: boolean;
  typeDefaultNaveLabel: string | null;
  groupNaveKind: NaveAssignmentKind;
  canManage: boolean;
  canAddExtra: boolean;
  showAssignNave: boolean;
  onAssignNave: () => void;
  onAddExtra: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
      <div className="space-y-0.5">
        {showLabel ? (
          <span className="text-xs font-medium">{label}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Tareas</span>
        )}
        {typeDefaultNaveLabel ? (
          <p className="text-[10px] text-muted-foreground">
            Nave del tipo: {typeDefaultNaveLabel}
          </p>
        ) : null}
        {groupNaveKind === "custom" || groupNaveKind === "mixed" ? (
          <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
            Este elemento tiene naves personalizadas
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {canAddExtra ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={onAddExtra}
            >
              <Plus className="size-3" />
              Añadir proceso extra
            </Button>
          ) : null}
          {showAssignNave ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onAssignNave}
            >
              <MapPin className="size-3" />
              Nave personalizada
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ElementNaveDialog({
  open,
  onOpenChange,
  lampId,
  groupKey,
  typeDefaultNaveLabel,
  naves,
  navesById,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lampId: string;
  groupKey: string;
  typeDefaultNaveLabel: string | null;
  naves: NaveSummary[];
  navesById: Map<string, NaveSummary>;
  onUpdated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedNaveId, setSelectedNaveId] = useState("");

  useEffect(() => {
    if (open) setSelectedNaveId("");
  }, [open]);

  const run = (action: () => Promise<void>, successMessage: string) => {
    startTransition(async () => {
      try {
        await action();
        toast.success(successMessage);
        onOpenChange(false);
        onUpdated();
      } catch (err) {
        toast.error(reportMutationError("Error", err));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nave personalizada para este elemento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {typeDefaultNaveLabel ? (
            <p className="text-xs text-muted-foreground">
              Nave por defecto del tipo:{" "}
              <span className="font-medium text-foreground">{typeDefaultNaveLabel}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            La nave del tipo se aplica al crear tareas. Aquí puedes asignar una
            nave distinta a todas las tareas de este elemento, o volver a la del
            tipo.
          </p>
          <div className="space-y-2">
            <Label>Nave</Label>
            <NavePicker
              value={selectedNaveId}
              naves={naves}
              navesById={navesById}
              onChange={setSelectedNaveId}
              disabled={pending}
              className="w-full"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  applyDefaultNavesToElement({
                    lampId,
                    elementGroupKey: groupKey,
                  }),
                "Nave del tipo restaurada",
              )
            }
          >
            Restaurar nave del tipo
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || !selectedNaveId}
            onClick={() =>
              run(
                () =>
                  assignElementTasksNave({
                    lampId,
                    elementGroupKey: groupKey,
                    naveId: selectedNaveId,
                  }),
                "Nave aplicada a todas las tareas del elemento",
              )
            }
          >
            Aplicar a todas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AggregatedTaskTable({
  rows,
  groupTasks,
  groupKey,
  lampId,
  defaultNaveId,
  naves,
  navesById,
  processStylesByCode,
  waitHoursByProcess,
  showUnits,
  canManage,
  pending,
  onUpdated,
}: {
  rows: TaskHoursAggregate[];
  groupTasks: LampTaskRow[];
  groupKey: string;
  lampId: string;
  defaultNaveId: string | null | undefined;
  naves: NaveSummary[];
  navesById: Map<string, NaveSummary>;
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  waitHoursByProcess: Record<string, number>;
  showUnits: boolean;
  canManage: boolean;
  pending: boolean;
  onUpdated: () => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-medium py-1.5 px-3 w-8">#</th>
          <th className="text-left font-medium py-1.5 px-2">Proceso</th>
          <th className="text-left font-medium py-1.5 px-2">Nave</th>
          <th className="text-right font-medium py-1.5 px-2">Est.</th>
          <th className="text-right font-medium py-1.5 px-2">Hecho</th>
          <th className="text-right font-medium py-1.5 px-2">Pend.</th>
          <th className="text-right font-medium py-1.5 px-2">Espera tras</th>
          {canManage ? (
            <th className="text-right font-medium py-1.5 px-2 w-10" />
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const waitAfter = dryWaitHoursForProcess(row.process, waitHoursByProcess);
          const matching = groupTasks.filter((task) => task.process === row.process);
          const naveSummary = summarizeNaveIds(
            matching.map((task) => task.naveId),
            navesById,
          );
          const displayNaveId = naveSummary.naveId ?? matching[0]?.naveId ?? "";
          const assignmentKind = describeNaveAssignment({
            naveIds: matching.map((task) => task.naveId),
            elementTypeDefaultNaveId: defaultNaveId,
          });
          const canDelete = matching.every((task) => task.doneHours <= 0);

          return (
            <tr key={row.process} className="border-t border-border/50">
              <td className="py-1.5 px-3 text-muted-foreground">{idx + 1}</td>
              <td className="py-1.5 px-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <ProcessBadge
                    code={row.process}
                    definition={processStylesByCode[row.process]}
                  />
                  {showUnits && row.units > 1 ? (
                    <span className="text-[10px] text-muted-foreground">
                      ×{row.units}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="py-1.5 px-2 min-w-[9rem]">
                {canManage && naves.length > 0 ? (
                  <NaveCell
                    naveId={displayNaveId}
                    defaultNaveId={defaultNaveId}
                    naves={naves}
                    navesById={navesById}
                    assignmentKind={assignmentKind}
                    disabled={pending}
                    onChange={(naveId) => {
                      if (!naveId || naveId === displayNaveId) return;
                      startTransition(async () => {
                        try {
                          await assignProcessTasksNave({
                            lampId,
                            elementGroupKey: groupKey,
                            process: row.process,
                            naveId,
                          });
                          onUpdated();
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Error",
                          );
                        }
                      });
                    }}
                  />
                ) : (
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {naveSummary.label}
                    </span>
                    {defaultNaveId ? (
                      <NaveAssignmentHint kind={assignmentKind} />
                    ) : null}
                  </div>
                )}
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {formatHours(row.estimatedHours)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {formatHours(row.doneHours)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono font-semibold">
                {formatHours(row.pendingHours)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                {waitAfter > 0 ? `${waitAfter}h` : "—"}
              </td>
              {canManage ? (
                <td className="py-1.5 px-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    disabled={!canDelete || pending}
                    onClick={() => {
                      const unitsLabel =
                        matching.length > 1
                          ? ` de las ${matching.length} unidades`
                          : "";
                      if (
                        !confirm(
                          `¿Eliminar el proceso ${row.process}${unitsLabel}?`,
                        )
                      ) {
                        return;
                      }
                      startTransition(async () => {
                        try {
                          await deleteProcessTasks({
                            lampId,
                            elementGroupKey: groupKey,
                            process: row.process,
                          });
                          toast.success("Proceso eliminado");
                          onUpdated();
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Error",
                          );
                        }
                      });
                    }}
                    aria-label={`Eliminar proceso ${row.process}`}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function LampTasksPanel({
  lampId,
  tasks,
  usedProcesses,
  waitHoursByProcess,
  processStylesByCode,
  canManage,
  naves = [],
  elementTypeDefaultNaves = {},
}: {
  lampId: string;
  tasks: LampTaskRow[];
  usedProcesses: ProcessCode[];
  waitHoursByProcess: Record<string, number>;
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  canManage: boolean;
  naves?: NaveSummary[];
  elementTypeDefaultNaves?: Record<string, string | null>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<TaskViewMode>("agrupada");
  const [naveDialogGroupKey, setNaveDialogGroupKey] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<LampTaskRow | null>(null);
  const [editHours, setEditHours] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addGroupKey, setAddGroupKey] = useState<string | null>(null);
  const [addProcess, setAddProcess] = useState("");
  const [addHours, setAddHours] = useState("");
  const [addNaveId, setAddNaveId] = useState("");

  const allProcessCodes = Object.keys(waitHoursByProcess);
  const availableProcesses = allProcessCodes.filter(
    (p) => !usedProcesses.includes(p),
  );

  function availableProcessesForGroup(groupTasks: LampTaskRow[]): string[] {
    const usedInGroup = new Set(groupTasks.map((task) => task.process));
    return allProcessCodes.filter((process) => !usedInGroup.has(process));
  }

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => a.order - b.order),
    [tasks],
  );

  const bastidorGroups = useMemo(() => groupTasksByBastidor(sorted), [sorted]);

  function defaultNaveIdForExtraTask(groupKey: string | null): string {
    if (groupKey) {
      return elementTypeDefaultNaves[groupKey] ?? naves[0]?.id ?? "";
    }
    if (bastidorGroups.length === 1) {
      return elementTypeDefaultNaves[bastidorGroups[0]!.key] ?? naves[0]?.id ?? "";
    }
    return naves[0]?.id ?? "";
  }

  function openAddExtraDialog(groupKey: string | null, processes: string[]) {
    setAddGroupKey(groupKey);
    setAddProcess(processes[0] ?? "");
    setAddHours("");
    setAddNaveId(defaultNaveIdForExtraTask(groupKey));
    setAddOpen(true);
  }

  const navesById = useMemo(() => {
    const map = new Map(naves.map((nave) => [nave.id, nave]));
    for (const task of sorted) {
      if (task.nave && !map.has(task.nave.id)) {
        map.set(task.nave.id, task.nave);
      }
    }
    return map;
  }, [naves, sorted]);
  const hasMultipleBastidores = bastidorGroups.length > 1;
  const showViewToggle =
    hasMultipleBastidores || bastidorGroups.some((g) => g.unitCount > 1);
  const effectiveViewMode: TaskViewMode = showViewToggle ? viewMode : "detalle";

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 px-3">Sin tareas</p>
    );
  }

  return (
    <div className="border-t bg-muted/20">
      {showViewToggle ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/50">
          <div className="flex rounded-lg border p-0.5 bg-background">
            <Button
              type="button"
              variant={viewMode === "agrupada" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setViewMode("agrupada")}
            >
              Agrupada
            </Button>
            <Button
              type="button"
              variant={viewMode === "detalle" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setViewMode("detalle")}
            >
              Detalle
            </Button>
          </div>
          {canManage ? (
            <p className="text-[10px] text-muted-foreground">
              {viewMode === "agrupada"
                ? "La nave aplica a todas las unidades del mismo proceso"
                : "La nave se edita tarea a tarea"}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="divide-y divide-border/50">
        {bastidorGroups.map((group) => {
          const groupTasks = group.tasks as LampTaskRow[];
          const groupAvailableProcesses = availableProcessesForGroup(groupTasks);
          const sectionLabel = bastidorSummaryLabel(
            group.frameTypeName,
            group.unitCount,
            group.surfaceM2,
          );
          const showSectionLabel =
            hasMultipleBastidores || group.unitCount > 1;
          const groupDefaultNaveId = elementTypeDefaultNaves[group.key] ?? null;
          const typeDefaultNaveLabel = defaultNaveLabelForGroup(
            group.key,
            elementTypeDefaultNaves,
            navesById,
          );
          const groupNaveKind = describeNaveAssignment({
            naveIds: groupTasks.map((task) => task.naveId),
            elementTypeDefaultNaveId: groupDefaultNaveId,
          });
          return (
            <section key={group.key}>
              <ElementSectionBar
                label={sectionLabel}
                showLabel={showSectionLabel}
                typeDefaultNaveLabel={typeDefaultNaveLabel}
                groupNaveKind={groupNaveKind}
                canManage={canManage}
                canAddExtra={groupAvailableProcesses.length > 0}
                showAssignNave={canManage && naves.length > 0}
                onAddExtra={() => openAddExtraDialog(group.key, groupAvailableProcesses)}
                onAssignNave={() => setNaveDialogGroupKey(group.key)}
              />

              {effectiveViewMode === "agrupada" ? (
                <AggregatedTaskTable
                  rows={aggregateTasksByProcess(groupTasks)}
                  groupTasks={groupTasks}
                  groupKey={group.key}
                  lampId={lampId}
                  defaultNaveId={groupDefaultNaveId}
                  naves={naves}
                  navesById={navesById}
                  processStylesByCode={processStylesByCode}
                  waitHoursByProcess={waitHoursByProcess}
                  showUnits={group.unitCount > 1}
                  canManage={canManage}
                  pending={pending}
                  onUpdated={() => router.refresh()}
                />
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium py-1.5 px-3 w-8">#</th>
                      <th className="text-left font-medium py-1.5 px-2">Proceso</th>
                      {group.unitCount > 1 ? (
                        <th className="text-left font-medium py-1.5 px-2">Unidad</th>
                      ) : null}
                      <th className="text-left font-medium py-1.5 px-2">Nave</th>
                      <th className="text-right font-medium py-1.5 px-2">Est.</th>
                      <th className="text-right font-medium py-1.5 px-2">Hecho</th>
                      <th className="text-right font-medium py-1.5 px-2">Pend.</th>
                      <th className="text-right font-medium py-1.5 px-2">Espera tras</th>
                      {canManage ? (
                        <th className="text-right font-medium py-1.5 px-2 w-28" />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...groupTasks]
                      .sort((a, b) => a.order - b.order)
                      .map((t, idx, groupSorted) => {
                        const waitAfter = dryWaitHoursForProcess(
                          t.process,
                          waitHoursByProcess,
                        );
                        return (
                          <tr
                            key={t.id}
                            {...withWorkOrderHighlight(t.workOrder?.number, "border-t border-border/50")}
                          >
                            <td className="py-1.5 px-3 text-muted-foreground">
                              {t.order + 1}
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1 flex-wrap">
                                <ProcessBadge
                                  code={t.process}
                                  definition={processStylesByCode[t.process]}
                                />
                                <WorkOrderBadge
                                  number={t.workOrder?.number}
                                  status={t.workOrder?.status}
                                />
                              </div>
                            </td>
                            {group.unitCount > 1 ? (
                              <td className="py-1.5 px-2 text-muted-foreground">
                                {t.lampElement?.label ??
                                  t.lampElement?.elementType.name ??
                                  "—"}
                              </td>
                            ) : null}
                            <td className="py-1.5 px-2 min-w-[9rem]">
                              {canManage && naves.length > 0 ? (
                                <NaveCell
                                  naveId={t.naveId}
                                  defaultNaveId={groupDefaultNaveId}
                                  naves={naves}
                                  navesById={navesById}
                                  assignmentKind={describeNaveAssignment({
                                    naveIds: [t.naveId],
                                    elementTypeDefaultNaveId: groupDefaultNaveId,
                                  })}
                                  disabled={pending}
                                  onChange={(naveId) => {
                                    if (naveId === t.naveId) return;
                                    startTransition(async () => {
                                      try {
                                        await updateTaskNave({
                                          taskId: t.id,
                                          naveId,
                                        });
                                        router.refresh();
                                      } catch (err) {
                                        toast.error(
                                          err instanceof Error
                                            ? err.message
                                            : "Error",
                                        );
                                      }
                                    });
                                  }}
                                />
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="text-muted-foreground whitespace-nowrap">
                                    {formatNaveLabel(
                                      t.nave ?? navesById.get(t.naveId),
                                      t.naveId,
                                    )}
                                  </span>
                                  {groupDefaultNaveId ? (
                                    <NaveAssignmentHint
                                      kind={describeNaveAssignment({
                                        naveIds: [t.naveId],
                                        elementTypeDefaultNaveId: groupDefaultNaveId,
                                      })}
                                    />
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatHours(t.estimatedHours)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatHours(t.doneHours)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-semibold">
                              {formatHours(t.pendingHours)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                              {waitAfter > 0 ? `${waitAfter}h` : "—"}
                            </td>
                            {canManage ? (
                              <td className="py-1.5 px-2 text-right">
                                <div className="flex justify-end gap-0.5">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      startTransition(async () => {
                                        try {
                                          await reorderTask({
                                            taskId: t.id,
                                            direction: "up",
                                          });
                                          router.refresh();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Error",
                                          );
                                        }
                                      });
                                    }}
                                    aria-label="Subir tarea"
                                  >
                                    <ArrowUp className="size-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={idx === groupSorted.length - 1}
                                    onClick={() => {
                                      startTransition(async () => {
                                        try {
                                          await reorderTask({
                                            taskId: t.id,
                                            direction: "down",
                                          });
                                          router.refresh();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Error",
                                          );
                                        }
                                      });
                                    }}
                                    aria-label="Bajar tarea"
                                  >
                                    <ArrowDown className="size-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => {
                                      setEditTask(t);
                                      setEditHours(String(t.estimatedHours));
                                      setEditNotes(t.notes ?? "");
                                    }}
                                    aria-label="Editar tarea"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn("size-7 text-destructive")}
                                    disabled={t.doneHours > 0}
                                    onClick={() => {
                                      if (
                                        !confirm(
                                          `¿Eliminar la tarea ${t.process}?`,
                                        )
                                      ) {
                                        return;
                                      }
                                      startTransition(async () => {
                                        try {
                                          await deleteTask({ taskId: t.id });
                                          toast.success("Tarea eliminada");
                                          router.refresh();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Error",
                                          );
                                        }
                                      });
                                    }}
                                    aria-label="Eliminar tarea"
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>

      {naveDialogGroupKey ? (
        <ElementNaveDialog
          open={naveDialogGroupKey != null}
          onOpenChange={(open) => {
            if (!open) setNaveDialogGroupKey(null);
          }}
          lampId={lampId}
          groupKey={naveDialogGroupKey}
          typeDefaultNaveLabel={defaultNaveLabelForGroup(
            naveDialogGroupKey,
            elementTypeDefaultNaves,
            navesById,
          )}
          naves={naves}
          navesById={navesById}
          onUpdated={() => router.refresh()}
        />
      ) : null}

      {canManage && availableProcesses.length > 0 ? (
        <div className="px-3 py-2 border-t">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => openAddExtraDialog(null, availableProcesses)}
          >
            <Plus className="size-3" />
            Añadir proceso extra
          </Button>
        </div>
      ) : null}

      <Dialog open={editTask != null} onOpenChange={(o) => !o && setEditTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar tarea</DialogTitle>
          </DialogHeader>
          {editTask ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const h = Number(editHours);
                if (!h || h <= 0) {
                  toast.error("Horas inválidas");
                  return;
                }
                startTransition(async () => {
                  try {
                    await updateTaskHours({
                      taskId: editTask.id,
                      estimatedHours: h,
                    });
                    await updateTaskNotes({
                      taskId: editTask.id,
                      notes: editNotes.trim() || null,
                    });
                    toast.success("Tarea actualizada");
                    setEditTask(null);
                    router.refresh();
                  } catch (err) {
                    toast.error(reportMutationError("Error", err));
                  }
                });
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <ProcessBadge
                  code={editTask.process}
                  definition={processStylesByCode[editTask.process]}
                />
                <WorkOrderBadge
                  number={editTask.workOrder?.number}
                  status={editTask.workOrder?.status}
                />
                {editTask.lampElement?.label ? (
                  <span className="text-xs text-muted-foreground">
                    {editTask.lampElement.label}
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Horas estimadas</Label>
                <Input
                  type="number"
                  step={0.25}
                  min={0.25}
                  required
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddGroupKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addGroupKey ? "Añadir proceso extra al elemento" : "Añadir proceso extra"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const h = Number(addHours);
              if (!addProcess || !h || h <= 0) {
                toast.error("Completa proceso y horas");
                return;
              }
              if (naves.length > 0 && !addNaveId) {
                toast.error("Selecciona una nave");
                return;
              }
              startTransition(async () => {
                try {
                  await addExtraTask({
                    lampId,
                    process: addProcess,
                    estimatedHours: h,
                    ...(addGroupKey ? { elementGroupKey: addGroupKey } : {}),
                    ...(addNaveId ? { naveId: addNaveId } : {}),
                  });
                  toast.success("Proceso añadido");
                  setAddOpen(false);
                  router.refresh();
                } catch (err) {
                  toast.error(reportMutationError("Error", err));
                }
              });
            }}
          >
            <div className="space-y-2">
              <Label>Proceso</Label>
              <Select value={addProcess} onValueChange={(v) => setAddProcess(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(addGroupKey
                    ? availableProcessesForGroup(
                        (bastidorGroups.find((group) => group.key === addGroupKey)
                          ?.tasks ?? []) as LampTaskRow[],
                      )
                    : availableProcesses
                  ).map((p) => (
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
                required
                value={addHours}
                onChange={(e) => setAddHours(e.target.value)}
              />
            </div>
            {naves.length > 0 ? (
              <div className="space-y-2">
                <Label>Nave</Label>
                <NavePicker
                  value={addNaveId}
                  naves={naves}
                  navesById={navesById}
                  disabled={pending}
                  className="w-full"
                  onChange={setAddNaveId}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Añadir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
