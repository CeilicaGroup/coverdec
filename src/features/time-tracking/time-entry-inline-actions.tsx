"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createManualEntryForTask,
  deleteEntry,
  updateEntry,
} from "@/features/time-tracking/actions";
import {
  fromDatetimeLocalInputValue,
  toDatetimeLocalInputValue,
} from "@/lib/datetime-local";
import { formatShortDate, formatTimeRangeFromStartAndHours } from "@/lib/format";
import { formatActualEntryStripeLabel } from "@/features/time-tracking/entry-label";
import { useTaskProgressTooltipPin } from "@/components/task-progress-tooltip-context";
import { ProgressStripeKindBadge } from "@/components/task-progress";

interface TimeEntryRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  notes?: string | null;
  label?: string;
  summaryLabel?: string;
  dateIso?: string;
  hours?: number;
  process?: string | null;
  isRunning?: boolean;
}

function entryDateLabel(entry: TimeEntryRow): string {
  if (entry.dateIso) {
    return formatShortDate(new Date(`${entry.dateIso}T00:00:00Z`));
  }
  return formatShortDate(new Date(entry.startedAt));
}

function entryHoursValue(entry: TimeEntryRow): number {
  if (entry.hours != null) return entry.hours;
  if (!entry.endedAt) return 0;
  return (
    (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 3_600_000
  );
}

function entryTimeSlotRange(entry: TimeEntryRow): string {
  return formatTimeRangeFromStartAndHours(
    new Date(entry.startedAt),
    entryHoursValue(entry),
  );
}

/** Una línea como la franja Plan: fecha · horario · horas · proceso */
function entryStripeLine(entry: TimeEntryRow): string {
  if (entry.label) return entry.label;
  if (entry.dateIso != null) {
    return formatActualEntryStripeLabel(
      entry.dateIso,
      new Date(entry.startedAt),
      entryHoursValue(entry),
      entry.process,
    );
  }
  return `${entryDateLabel(entry)} · ${entryTimeSlotRange(entry)}`;
}

export function TimeEntryInlineActions({
  entries,
  entryId,
  userId,
  personId,
  projectId,
  lampId,
  taskId,
  process,
  startedAt,
  endedAt,
  notes,
  defaultStartedAt,
  defaultEndedAt,
  canEdit,
  canDelete,
  canCreate,
  trailingActions,
}: {
  entries?: TimeEntryRow[];
  entryId?: string;
  userId?: string;
  personId?: string;
  projectId: string;
  lampId?: string | null;
  taskId?: string | null;
  process?: string | null;
  startedAt: string;
  endedAt?: string | null;
  notes?: string | null;
  defaultStartedAt?: string;
  defaultEndedAt?: string;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  trailingActions?: ReactNode;
}) {
  const { pinTooltip, unpinTooltip } = useTaskProgressTooltipPin();
  const [pending, startTransition] = useTransition();
  const [openEdit, setOpenEdit] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const resolvedEntries = useMemo(() => {
    if (entries && entries.length > 0) return entries.filter((e) => e.endedAt);
    if (entryId && endedAt) {
      return [{ id: entryId, startedAt, endedAt, notes }];
    }
    return [];
  }, [entries, entryId, startedAt, endedAt, notes]);

  const createDefaults = useMemo(() => {
    const start = defaultStartedAt ?? startedAt;
    const end = defaultEndedAt ?? endedAt ?? startedAt;
    return {
      start: toDatetimeLocalInputValue(start),
      end: toDatetimeLocalInputValue(end),
    };
  }, [defaultStartedAt, defaultEndedAt, startedAt, endedAt]);

  const [editStart, setEditStart] = useState(createDefaults.start);
  const [editEnd, setEditEnd] = useState(createDefaults.end);
  const [editNotes, setEditNotes] = useState(notes ?? "");
  const [createStart, setCreateStart] = useState(createDefaults.start);
  const [createEnd, setCreateEnd] = useState(createDefaults.end);
  const [createNotes, setCreateNotes] = useState("");

  const canCreateForTask = canCreate && Boolean((userId || personId) && taskId && process && projectId);

  const createPayload = useMemo(
    () => ({
      userId,
      personId,
      projectId,
      lampId: lampId ?? undefined,
      taskId: taskId ?? "",
      process: process ?? "",
    }),
    [userId, personId, projectId, lampId, taskId, process],
  );

  useEffect(() => {
    if (!openCreate) return;
    setCreateStart(createDefaults.start);
    setCreateEnd(createDefaults.end);
    setCreateNotes("");
  }, [openCreate, createDefaults.start, createDefaults.end]);

  const dialogOpen = openEdit || openCreate;

  useEffect(() => {
    if (dialogOpen) pinTooltip();
    else unpinTooltip();
  }, [dialogOpen, pinTooltip, unpinTooltip]);

  function handleDialogOpenChange(open: boolean) {
    if (open) pinTooltip();
    else unpinTooltip();
  }

  function openEditDialog(entry: TimeEntryRow) {
    setEditingEntry(entry);
    setEditStart(toDatetimeLocalInputValue(entry.startedAt));
    setEditEnd(toDatetimeLocalInputValue(entry.endedAt ?? entry.startedAt));
    setEditNotes(entry.notes ?? "");
    pinTooltip();
    setOpenEdit(true);
  }

  function openCreateDialog() {
    setCreateStart(createDefaults.start);
    setCreateEnd(createDefaults.end);
    setCreateNotes("");
    pinTooltip();
    setOpenCreate(true);
  }

  const dialogs =
    mounted &&
    createPortal(
      <>
        <Dialog
          open={openEdit}
          onOpenChange={(open) => {
            handleDialogOpenChange(open);
            setOpenEdit(open);
            if (!open) setEditingEntry(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar registro</DialogTitle>
              <DialogDescription>Ajusta horario y notas.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Inicio</Label>
                <Input
                  type="datetime-local"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Fin</Label>
                <Input
                  type="datetime-local"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                disabled={pending || !editingEntry}
                onClick={() =>
                  startTransition(async () => {
                    if (!editingEntry) return;
                    try {
                      await updateEntry({
                        entryId: editingEntry.id,
                        startedAt: fromDatetimeLocalInputValue(editStart),
                        endedAt: fromDatetimeLocalInputValue(editEnd),
                        notes: editNotes || undefined,
                      });
                      toast.success("Registro actualizado");
                      setOpenEdit(false);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Error");
                    }
                  })
                }
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={openCreate}
          onOpenChange={(open) => {
            handleDialogOpenChange(open);
            setOpenCreate(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo registro</DialogTitle>
              <DialogDescription>
                Horario por defecto según planning. Puedes ajustarlo antes de guardar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Inicio</Label>
                <Input
                  type="datetime-local"
                  value={createStart}
                  onChange={(e) => setCreateStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Fin</Label>
                <Input
                  type="datetime-local"
                  value={createEnd}
                  onChange={(e) => setCreateEnd(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Textarea
                  rows={2}
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await createManualEntryForTask({
                        ...createPayload,
                        startedAt: fromDatetimeLocalInputValue(createStart),
                        endedAt: fromDatetimeLocalInputValue(createEnd),
                        notes: createNotes || undefined,
                      });
                      toast.success("Registro creado");
                      setOpenCreate(false);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Error");
                    }
                  })
                }
              >
                Crear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>,
      document.body,
    );

  return (
    <>
      <div
        className="flex flex-col gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {resolvedEntries.length > 0 ? (
          <ul className="space-y-1.5">
            {resolvedEntries.map((entry) => {
              const actions = (
                <div className="flex shrink-0 items-center gap-0.5">
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={pending}
                      onClick={() => openEditDialog(entry)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          try {
                            await deleteEntry({ entryId: entry.id });
                            toast.success("Registro eliminado");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Error");
                          }
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              );

              return (
                <li key={entry.id} className="rounded-md border px-2 py-1">
                  <ProgressStripeKindBadge kind="actual" isRunning={entry.isRunning} />
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate">{entryStripeLine(entry)}</span>
                    {actions}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {canCreateForTask ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-[11px] gap-1"
                disabled={pending}
                onClick={openCreateDialog}
              >
                <Plus className="size-3.5" />
                Añadir registro
              </Button>
            ) : null}
          </div>
          {trailingActions ? (
            <div className="flex shrink-0 items-center">{trailingActions}</div>
          ) : null}
        </div>
      </div>
      {dialogs}
    </>
  );
}
