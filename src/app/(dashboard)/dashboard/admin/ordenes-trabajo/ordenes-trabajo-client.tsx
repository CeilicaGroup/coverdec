"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Layers,
  Pencil,
  Plus,
  Split,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { LampElementVisual } from "@/components/lamp-element-visual";
import { getTaskLampElementVisualProps } from "@/features/planning/task-lamp-frame";
import { WorkOrderHoverTrigger } from "@/components/work-order-badge";
import {
  autoGroupIdenticalTasks,
  createWorkOrder,
  deleteWorkOrder,
  splitWorkOrder,
  updateWorkOrderAlertThresholds,
  updateWorkOrder,
} from "@/features/work-orders/actions";
import {
  buildWorkOrderAttentionMetrics,
  compareWorkOrdersByAttention,
  type WorkOrderAttentionStatus,
} from "@/features/work-orders/attention-priority";
import type { TaskAssigneeSummary } from "@/features/work-orders/display-context";
import {
  summarizeWorkOrderAssignee,
  summarizeWorkOrderElementProcess,
} from "@/features/work-orders/display-context";
import { withWorkOrderHighlight } from "@/features/work-orders/highlight";
import type { EligibleWorkOrderTask } from "@/features/work-orders/queries";
import {
  WorkOrderTaskPicker,
  workOrderTaskLabel,
} from "@/features/work-orders/work-order-task-picker";
import { formatHours, formatShortDate } from "@/lib/format";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";

type WorkOrderStatusFilter = "OPEN" | "CLOSED" | "ALL";

const WORK_ORDER_STATUS_FILTERS: { value: WorkOrderStatusFilter; label: string }[] = [
  { value: "OPEN", label: "Abiertas" },
  { value: "CLOSED", label: "Cerradas" },
  { value: "ALL", label: "Todas" },
];

function workOrderStatusFilterLabel(value: WorkOrderStatusFilter): string {
  return WORK_ORDER_STATUS_FILTERS.find((option) => option.value === value)?.label ?? "Abiertas";
}

interface WorkOrderRow {
  id: string;
  number: string;
  status: "OPEN" | "CLOSED";
  notes: string | null;
  createdAt: Date;
  closedAt: Date | null;
  tasks: EligibleWorkOrderTask[];
}

const DEFAULT_MAX_PENDING_HOURS = 16;
const DEFAULT_MAX_TASKS = 8;

function pendingHours(tasks: EligibleWorkOrderTask[]) {
  return tasks
    .filter((t) => !t.isCompleted)
    .reduce((sum, t) => sum + t.estimatedHours, 0);
}

function parseThreshold(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function attentionStatusLabel(status: WorkOrderAttentionStatus): string {
  if (status === "excess_both") return "Exceso horas y tareas";
  if (status === "excess_hours") return "Exceso de horas";
  if (status === "excess_tasks") return "Exceso de tareas";
  return "Normal";
}

function taskTypeLabels(tasks: EligibleWorkOrderTask[]): string[] {
  const labels = new Set<string>();
  for (const task of tasks) {
    const elementLabel = getTaskLampElementVisualProps(task).label ?? "Sin elemento";
    const processLabel = task.processDefinition.label ?? task.process;
    labels.add(`${elementLabel} · ${processLabel}`);
  }
  return [...labels];
}

function ElementProcessCell({
  tasks,
  processStylesByCode,
  typologyImages,
  elementTypeImages,
}: {
  tasks: EligibleWorkOrderTask[];
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  typologyImages: TypologyImageAvailability;
  elementTypeImages: ElementTypeImageAvailability;
}) {
  const summary = summarizeWorkOrderElementProcess(tasks);
  if (summary.kind === "unknown") return <span className="text-muted-foreground">—</span>;
  if (summary.kind === "multiple") {
    const labels = taskTypeLabels(tasks);
    const first = labels[0] ?? "Varios";
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-sm text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">
                {first} (+{Math.max(0, labels.length - 1)})
              </span>
            }
          />
          <TooltipContent side="top" className="max-w-sm">
            <p className="mb-1.5 font-medium">Tipos de tarea en la OT</p>
            <ol className="list-decimal list-inside space-y-0.5">
              {labels.map((label, index) => (
                <li key={`${label}-${index}`}>{label}</li>
              ))}
            </ol>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  const first = tasks.find((t) => t.process === summary.processCode) ?? tasks[0];
  const visual = first ? getTaskLampElementVisualProps(first) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {visual ? (
        <LampElementVisual
          {...visual}
          typologyImages={typologyImages}
          elementTypeImages={elementTypeImages}
          size="sm"
          compact
        />
      ) : (
        <span className="text-sm">{summary.elementName}</span>
      )}
      <ProcessBadge
        code={summary.processCode}
        definition={processStylesByCode[summary.processCode]}
      />
    </div>
  );
}

function AssigneeCell({
  taskIds,
  assigneeByTaskId,
}: {
  taskIds: string[];
  assigneeByTaskId: Map<string, TaskAssigneeSummary>;
}) {
  const summary = summarizeWorkOrderAssignee(taskIds, assigneeByTaskId);
  if (summary.kind === "none") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (summary.kind === "multiple") {
    return <span className="text-sm text-muted-foreground">Varios</span>;
  }
  return (
    <span className="text-sm font-medium" title={summary.assignee.label}>
      {summary.assignee.iniciales}
    </span>
  );
}

export function OrdenesTrabajoClient({
  workOrders,
  eligibleTasks,
  statusFilter,
  assigneeByTaskId: assigneeByTaskIdRecord,
  processStylesByCode,
  workOrderIdsWithTimeEntries,
  workOrderIdsWithPlanningAssignments,
  initialAlertThresholds,
  typologyImages,
  elementTypeImages,
}: {
  workOrders: WorkOrderRow[];
  eligibleTasks: EligibleWorkOrderTask[];
  statusFilter: WorkOrderStatusFilter;
  assigneeByTaskId: Record<string, TaskAssigneeSummary>;
  processStylesByCode: Record<string, ProcessBadgeStyle>;
  workOrderIdsWithTimeEntries: string[];
  workOrderIdsWithPlanningAssignments: string[];
  initialAlertThresholds: {
    maxPendingHours: number;
    maxTasks: number;
  };
  typologyImages: TypologyImageAvailability;
  elementTypeImages: ElementTypeImageAvailability;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [unassignedDetailsOpen, setUnassignedDetailsOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<WorkOrderRow | null>(null);
  const [splitOrder, setSplitOrder] = useState<WorkOrderRow | null>(null);
  const [deleteOrder, setDeleteOrder] = useState<WorkOrderRow | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [editTaskIds, setEditTaskIds] = useState<string[]>([]);
  const [splitTaskIds, setSplitTaskIds] = useState<string[]>([]);
  const [editTasksById, setEditTasksById] = useState<Map<string, EligibleWorkOrderTask>>(
    new Map(),
  );
  const [notes, setNotes] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [splitNotes, setSplitNotes] = useState("");
  const [maxPendingHoursInput, setMaxPendingHoursInput] = useState(
    String(initialAlertThresholds.maxPendingHours),
  );
  const [maxTasksInput, setMaxTasksInput] = useState(String(initialAlertThresholds.maxTasks));

  const assigneeByTaskId = useMemo(
    () => new Map(Object.entries(assigneeByTaskIdRecord)),
    [assigneeByTaskIdRecord],
  );
  const timeEntriesBlocked = useMemo(
    () => new Set(workOrderIdsWithTimeEntries),
    [workOrderIdsWithTimeEntries],
  );
  const planningBlocked = useMemo(
    () => new Set(workOrderIdsWithPlanningAssignments),
    [workOrderIdsWithPlanningAssignments],
  );

  const deleteBlockReason = (workOrderId: string): string | null => {
    if (timeEntriesBlocked.has(workOrderId)) {
      return "No se puede eliminar: hay registros de tiempo en tareas de esta OT";
    }
    if (planningBlocked.has(workOrderId)) {
      return "No se puede eliminar: hay tareas planificadas en esta OT";
    }
    return null;
  };

  const eligibleById = useMemo(
    () => new Map(eligibleTasks.map((t) => [t.id, t])),
    [eligibleTasks],
  );

  const openCreate = () => {
    setSelectedTaskIds([]);
    setNotes("");
    setCreateOpen(true);
  };

  const openEdit = (order: WorkOrderRow) => {
    setEditOrder(order);
    setEditTaskIds(order.tasks.map((t) => t.id));
    setEditTasksById(new Map(order.tasks.map((t) => [t.id, t])));
    setEditNotes(order.notes ?? "");
  };

  const openSplit = (order: WorkOrderRow) => {
    setSplitOrder(order);
    setSplitTaskIds([]);
    setSplitNotes("");
  };

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  const toggleEditAddTask = (taskId: string) => {
    if (editTaskIds.includes(taskId)) return;
    const task = eligibleById.get(taskId);
    if (!task) return;
    setEditTasksById((prev) => new Map(prev).set(taskId, task));
    setEditTaskIds((prev) => [...prev, taskId]);
  };

  const toggleSplitTask = (taskId: string) => {
    setSplitTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  const moveTask = (index: number, direction: -1 | 1) => {
    setEditTaskIds((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const removeEditTask = (taskId: string) => {
    setEditTaskIds((prev) => prev.filter((id) => id !== taskId));
  };

  const onStatusFilter = (value: string | null) => {
    if (!value) return;
    const filter = value as WorkOrderStatusFilter;
    startTransition(() => {
      if (filter === "OPEN") {
        router.push("/dashboard/admin/ordenes-trabajo");
        return;
      }
      router.push(`/dashboard/admin/ordenes-trabajo?status=${filter}`);
    });
  };

  const onAutoGroup = () => {
    startTransition(async () => {
      const result = await autoGroupIdenticalTasks();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.ordersCreated} OT creadas · ${result.data.tasksGrouped} tareas agrupadas`,
      );
      router.refresh();
    });
  };

  const onCreate = () => {
    startTransition(async () => {
      const result = await createWorkOrder({
        taskIds: selectedTaskIds,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`OT ${result.data.number} creada`);
      setCreateOpen(false);
      router.refresh();
    });
  };

  const onUpdate = () => {
    if (!editOrder) return;
    startTransition(async () => {
      const result = await updateWorkOrder({
        id: editOrder.id,
        taskIds: editTaskIds,
        notes: editNotes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("OT actualizada");
      setEditOrder(null);
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!deleteOrder) return;
    startTransition(async () => {
      const result = await deleteWorkOrder({ id: deleteOrder.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("OT eliminada");
      setDeleteOrder(null);
      router.refresh();
    });
  };

  const onSplit = () => {
    if (!splitOrder) return;
    startTransition(async () => {
      const result = await splitWorkOrder({
        id: splitOrder.id,
        taskIds: splitTaskIds,
        notes: splitNotes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`OT ${splitOrder.number} dividida en ${result.data.number}`);
      setSplitOrder(null);
      router.refresh();
    });
  };

  const addableTasks = editOrder
    ? eligibleTasks.filter((t) => !editTaskIds.includes(t.id))
    : [];

  const unassignedTaskCount = eligibleTasks.length;
  const unassignedTaskHours = useMemo(
    () => pendingHours(eligibleTasks),
    [eligibleTasks],
  );
  const maxPendingHours = useMemo(
    () => parseThreshold(maxPendingHoursInput, DEFAULT_MAX_PENDING_HOURS),
    [maxPendingHoursInput],
  );
  const maxTasks = useMemo(
    () => parseThreshold(maxTasksInput, DEFAULT_MAX_TASKS),
    [maxTasksInput],
  );
  const persistAlertThresholds = () => {
    const normalized = {
      maxPendingHours: parseThreshold(maxPendingHoursInput, DEFAULT_MAX_PENDING_HOURS),
      maxTasks: parseThreshold(maxTasksInput, DEFAULT_MAX_TASKS),
    };
    setMaxPendingHoursInput(String(normalized.maxPendingHours));
    setMaxTasksInput(String(normalized.maxTasks));
    startTransition(async () => {
      const result = await updateWorkOrderAlertThresholds(normalized);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  };
  const workOrdersWithAttention = useMemo(
    () =>
      workOrders
        .map((order) => {
          const orderPendingHours = pendingHours(order.tasks);
          return {
            ...order,
            pendingHours: orderPendingHours,
            taskCount: order.tasks.length,
            attention: buildWorkOrderAttentionMetrics(
              {
                status: order.status,
                pendingHours: orderPendingHours,
                taskCount: order.tasks.length,
              },
              { maxPendingHours, maxTasks },
            ),
          };
        })
        .sort(compareWorkOrdersByAttention),
    [maxPendingHours, maxTasks, workOrders],
  );
  const excessiveOpenCount = useMemo(
    () =>
      workOrdersWithAttention.filter(
        (order) => order.status === "OPEN" && order.attention.needsAttention,
      ).length,
    [workOrdersWithAttention],
  );
  const splitSelectedHours = useMemo(() => {
    if (!splitOrder) return 0;
    const selected = new Set(splitTaskIds);
    return splitOrder.tasks
      .filter((task) => selected.has(task.id))
      .reduce((sum, task) => sum + task.estimatedHours, 0);
  }, [splitOrder, splitTaskIds]);
  const splitRemainingHours = useMemo(() => {
    if (!splitOrder) return 0;
    return pendingHours(splitOrder.tasks) - splitSelectedHours;
  }, [splitOrder, splitSelectedHours]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {unassignedTaskCount > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                <span>
                  {unassignedTaskCount} tarea
                  {unassignedTaskCount !== 1 ? "s" : ""} sin OT
                  {unassignedTaskHours > 0
                    ? ` · ${formatHours(unassignedTaskHours)} pendientes`
                    : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setUnassignedDetailsOpen(true)}
                >
                  Ver detalles
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAutoGroup}
                  disabled={pending}
                >
                  Agrupar procesos iguales
                </Button>
                <Button type="button" size="sm" onClick={openCreate} disabled={pending}>
                  Nueva OT
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Select value={statusFilter} onValueChange={onStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Estado">
                {workOrderStatusFilterLabel(statusFilter)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WORK_ORDER_STATUS_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="secondary" onClick={onAutoGroup} disabled={pending}>
            <Layers className="size-4 mr-1.5" />
            Agrupar procesos iguales
          </Button>
          <Button type="button" onClick={openCreate} disabled={pending}>
            <Plus className="size-4 mr-1.5" />
            Nueva OT
          </Button>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="ot-max-hours" className="text-xs text-muted-foreground">
                Alerta horas
              </Label>
              <Input
                id="ot-max-hours"
                type="number"
                min={1}
                className="h-9 w-24"
                value={maxPendingHoursInput}
                onChange={(e) => setMaxPendingHoursInput(e.target.value)}
                onBlur={persistAlertThresholds}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    persistAlertThresholds();
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ot-max-tasks" className="text-xs text-muted-foreground">
                Alerta tareas
              </Label>
              <Input
                id="ot-max-tasks"
                type="number"
                min={1}
                className="h-9 w-24"
                value={maxTasksInput}
                onChange={(e) => setMaxTasksInput(e.target.value)}
                onBlur={persistAlertThresholds}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    persistAlertThresholds();
                  }
                }}
              />
            </div>
          </div>
        </div>

        {excessiveOpenCount > 0 ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-destructive" />
                <span>
                  {excessiveOpenCount} OT abierta{excessiveOpenCount !== 1 ? "s" : ""} requiere
                  mayor atención con los umbrales actuales ({maxPendingHours}h / {maxTasks} tareas).
                </span>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OT</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Atención</TableHead>
                  <TableHead>Elemento · Proceso</TableHead>
                  <TableHead>Operario</TableHead>
                  <TableHead>Tareas</TableHead>
                  <TableHead>Horas pend.</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead>Cerrada</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workOrdersWithAttention.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No hay órdenes de trabajo
                    </TableCell>
                  </TableRow>
                ) : (
                  workOrdersWithAttention.map((order) => {
                    const blockReason = deleteBlockReason(order.id);
                    const deleteButton = (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteOrder(order)}
                        disabled={pending || blockReason != null}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    );

                    return (
                      <TableRow
                        key={order.id}
                        {...withWorkOrderHighlight(order.number)}
                      >
                        <TableCell className="font-mono font-semibold">
                          <WorkOrderHoverTrigger number={order.number}>
                            {order.number}
                          </WorkOrderHoverTrigger>
                        </TableCell>
                        <TableCell>
                          <Badge variant={order.status === "OPEN" ? "default" : "secondary"}>
                            {order.status === "OPEN" ? "Abierta" : "Cerrada"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {order.attention.needsAttention ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="size-3.5" />
                              {attentionStatusLabel(order.attention.status)}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">Normal</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ElementProcessCell
                            tasks={order.tasks}
                            processStylesByCode={processStylesByCode}
                            typologyImages={typologyImages}
                            elementTypeImages={elementTypeImages}
                          />
                        </TableCell>
                        <TableCell>
                          <AssigneeCell
                            taskIds={order.tasks.map((t) => t.id)}
                            assigneeByTaskId={assigneeByTaskId}
                          />
                        </TableCell>
                        <TableCell>{order.taskCount}</TableCell>
                        <TableCell>{formatHours(order.pendingHours)}</TableCell>
                        <TableCell>{formatShortDate(order.createdAt)}</TableCell>
                        <TableCell>
                          {order.closedAt ? formatShortDate(order.closedAt) : "—"}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {order.status === "OPEN" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openSplit(order)}
                              disabled={pending || order.taskCount < 2}
                              title={
                                order.taskCount < 2
                                  ? "Se necesitan al menos 2 tareas para dividir"
                                  : "Dividir OT"
                              }
                            >
                              <Split className="size-4" />
                            </Button>
                          ) : null}
                          {order.status === "OPEN" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(order)}
                              disabled={pending}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          ) : null}
                          {blockReason ? (
                            <Tooltip>
                              <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                                {deleteButton}
                              </TooltipTrigger>
                              <TooltipContent>{blockReason}</TooltipContent>
                            </Tooltip>
                          ) : (
                            deleteButton
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={unassignedDetailsOpen} onOpenChange={setUnassignedDetailsOpen}>
          <DialogContent className="flex max-w-2xl max-h-[85vh] flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Tareas sin OT</DialogTitle>
              </DialogHeader>
              <WorkOrderTaskPicker
                tasks={eligibleTasks}
                selectedIds={[]}
                onToggle={() => {}}
                processStylesByCode={processStylesByCode}
                typologyImages={typologyImages}
                elementTypeImages={elementTypeImages}
                emptyMessage="No hay tareas pendientes sin OT"
                readOnly
              />
            </div>
            <DialogFooter className="shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnassignedDetailsOpen(false)}
              >
                Cerrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="flex max-w-2xl max-h-[85vh] flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nueva orden de trabajo</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wo-notes">Notas</Label>
                  <Textarea
                    id="wo-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tareas ({selectedTaskIds.length} seleccionadas)</Label>
                  <WorkOrderTaskPicker
                    tasks={eligibleTasks}
                    selectedIds={selectedTaskIds}
                    onToggle={toggleTask}
                    processStylesByCode={processStylesByCode}
                    typologyImages={typologyImages}
                    elementTypeImages={elementTypeImages}
                    emptyMessage="No hay tareas pendientes sin OT"
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={onCreate}
                disabled={pending || selectedTaskIds.length < 1}
              >
                Crear OT
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOrder != null} onOpenChange={(open) => !open && setEditOrder(null)}>
          <DialogContent className="flex max-w-2xl max-h-[85vh] flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Editar {editOrder?.number}</DialogTitle>
              </DialogHeader>
              {editOrder ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-wo-notes">Notas</Label>
                    <Textarea
                      id="edit-wo-notes"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Orden de tareas ({editTaskIds.length})</Label>
                    <div className="border rounded-md divide-y">
                      {editTaskIds.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">Sin tareas</p>
                      ) : (
                        editTaskIds.map((taskId, index) => {
                          const task = editTasksById.get(taskId) ?? eligibleById.get(taskId);
                          const assignee = assigneeByTaskId.get(taskId);
                          return (
                            <div
                              key={taskId}
                              {...withWorkOrderHighlight(editOrder.number, "flex items-center gap-2 p-2")}
                            >
                              <span className="font-mono text-xs w-5 text-muted-foreground">
                                {index + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">
                                  {task ? workOrderTaskLabel(task) : taskId}
                                </div>
                                {assignee ? (
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    Operario: {assignee.label}
                                  </div>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => moveTask(index, -1)}
                                disabled={index === 0}
                              >
                                <ArrowUp className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => moveTask(index, 1)}
                                disabled={index === editTaskIds.length - 1}
                              >
                                <ArrowDown className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => removeEditTask(taskId)}
                              >
                                <Trash2 className="size-3.5 text-destructive" />
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Añadir tareas</Label>
                    <WorkOrderTaskPicker
                      tasks={addableTasks}
                      selectedIds={[]}
                      onToggle={toggleEditAddTask}
                      processStylesByCode={processStylesByCode}
                      typologyImages={typologyImages}
                      elementTypeImages={elementTypeImages}
                      emptyMessage="No hay más tareas pendientes disponibles"
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={() => setEditOrder(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={onUpdate}
                disabled={pending || editTaskIds.length < 1}
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={splitOrder != null} onOpenChange={(open) => !open && setSplitOrder(null)}>
          <DialogContent className="flex max-w-2xl max-h-[85vh] flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Dividir {splitOrder?.number}</DialogTitle>
              </DialogHeader>
              {splitOrder ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="split-wo-notes">Notas de la nueva OT</Label>
                    <Textarea
                      id="split-wo-notes"
                      value={splitNotes}
                      onChange={(e) => setSplitNotes(e.target.value)}
                      rows={2}
                      placeholder="Opcional"
                    />
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <p>
                      Seleccionadas: {splitTaskIds.length} · {formatHours(splitSelectedHours)}
                    </p>
                    <p className="text-muted-foreground">
                      Permanecen en origen: {splitOrder.tasks.length - splitTaskIds.length} ·{" "}
                      {formatHours(splitRemainingHours)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Tareas a mover</Label>
                    <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                      {splitOrder.tasks.map((task) => (
                        <label
                          key={task.id}
                          className="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                        >
                          <Checkbox
                            checked={splitTaskIds.includes(task.id)}
                            onCheckedChange={() => toggleSplitTask(task.id)}
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-sm font-medium truncate">
                              {workOrderTaskLabel(task)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatHours(task.estimatedHours)}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={() => setSplitOrder(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={onSplit}
                disabled={
                  pending ||
                  !splitOrder ||
                  splitTaskIds.length < 1 ||
                  splitTaskIds.length >= splitOrder.tasks.length
                }
              >
                Confirmar división
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteOrder != null} onOpenChange={(open) => !open && setDeleteOrder(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Eliminar {deleteOrder?.number}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Las tareas quedarán desvinculadas de la OT. Esta acción no se puede deshacer.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteOrder(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={onDelete} disabled={pending}>
                Eliminar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
