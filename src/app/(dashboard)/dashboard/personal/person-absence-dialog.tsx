"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatAbsenceDetail } from "@/features/people/absence-display";
import { AbsenceForm } from "@/features/people/absence-form";
import { deleteAbsence } from "@/features/people/actions";
import { civilIsoFromLocalDate, localDateFromCivilIso } from "@/lib/civil-date";
import { toast } from "sonner";

interface AbsenceRow {
  id: string;
  date: string;
  endDate: string;
  hours: number;
  reason: string | null;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

export function PersonAbsenceDialog({
  personId,
  personName,
  absences,
}: {
  personId: string;
  personName: string;
  absences: AbsenceRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Date | undefined>(new Date());
  const [editingId, setEditingId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...absences].sort((a, b) => a.date.localeCompare(b.date)),
    [absences],
  );

  const editing = useMemo(
    () => (editingId ? sorted.find((a) => a.id === editingId) ?? null : null),
    [editingId, sorted],
  );

  const selectedIso = selected ? civilIsoFromLocalDate(selected) : "";

  function remove(absence: AbsenceRow) {
    startTransition(async () => {
      const result = await deleteAbsence({ id: absence.id, personId, date: absence.date });
      const outcome = handleActionResult("absence.delete", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success("Ausencia eliminada");
      if (editingId === absence.id) setEditingId(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1">
            <CalendarOff className="size-3" />
            Ausencias
          </Button>
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ausencias — {personName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col sm:flex-row gap-4">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            className="rounded-md border"
          />
          <div className="flex-1 min-w-0">
            {selectedIso ? (
              <AbsenceForm
                key={`${editingId ?? "new"}-${selectedIso}`}
                personId={personId}
                selectedDateIso={editing?.date ?? selectedIso}
                editing={
                  editing
                    ? {
                        id: editing.id,
                        date: editing.date,
                        endDate: editing.endDate,
                        hours: editing.hours,
                        reason: editing.reason ?? "",
                        blockStartMinutes: editing.blockStartMinutes,
                        blockEndMinutes: editing.blockEndMinutes,
                      }
                    : null
                }
                pending={pending}
                onPendingChange={(fn) => startTransition(fn)}
                onSaved={() => {
                  setEditingId(null);
                  router.refresh();
                }}
                onCancelEdit={() => setEditingId(null)}
              />
            ) : null}
          </div>
        </div>
        {sorted.length > 0 ? (
          <ul className="text-xs space-y-1 max-h-32 overflow-y-auto border-t pt-2">
            {sorted.map((a) => (
              <li key={a.id} className="flex justify-between items-center gap-2">
                <span>{formatAbsenceDetail(a)}</span>
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6"
                    disabled={pending}
                    onClick={() => {
                      setEditingId(a.id);
                      setSelected(localDateFromCivilIso(a.date));
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-destructive"
                    disabled={pending}
                    onClick={() => remove(a)}
                  >
                    Quitar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sin ausencias registradas.</p>
        )}
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
