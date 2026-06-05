"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VACATION_ABSENCE_REASON } from "@/features/people/absence-constants";
import { FULL_DAY_BLOCK_END, FULL_DAY_BLOCK_START } from "@/features/people/absence-model";
import { setAbsence } from "@/features/people/actions";
import { formatCivilIsoDate } from "@/lib/civil-date";
import { toast } from "sonner";

export type AbsenceFormMode = "block" | "day" | "range";

interface AbsenceEditState {
  id: string;
  date: string;
  endDate: string;
  hours: number;
  reason: string;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

function timeInputToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function inferEditMode(edit: AbsenceEditState): AbsenceFormMode {
  if (edit.endDate > edit.date) return "range";
  if (
    edit.blockStartMinutes === FULL_DAY_BLOCK_START &&
    edit.blockEndMinutes === FULL_DAY_BLOCK_END
  ) {
    return "day";
  }
  if (
    edit.blockStartMinutes != null &&
    edit.blockEndMinutes != null &&
    edit.blockEndMinutes > edit.blockStartMinutes
  ) {
    return "block";
  }
  return "day";
}

export function AbsenceForm({
  personId,
  selectedDateIso,
  editing,
  pending,
  onPendingChange,
  onSaved,
  onCancelEdit,
}: {
  personId: string;
  selectedDateIso: string;
  editing: AbsenceEditState | null;
  pending: boolean;
  onPendingChange: (fn: () => Promise<void>) => void;
  onSaved: () => void;
  onCancelEdit?: () => void;
}) {
  const [mode, setMode] = useState<AbsenceFormMode>(editing ? inferEditMode(editing) : "day");
  const [blockStart, setBlockStart] = useState(
    editing?.blockStartMinutes != null ? minutesToTime(editing.blockStartMinutes) : "09:00",
  );
  const [blockEnd, setBlockEnd] = useState(
    editing?.blockEndMinutes != null ? minutesToTime(editing.blockEndMinutes) : "13:00",
  );
  const [reason, setReason] = useState(editing?.reason ?? "");
  const [rangeEndDate, setRangeEndDate] = useState(editing?.endDate ?? selectedDateIso);

  useEffect(() => {
    if (editing) {
      setMode(inferEditMode(editing));
      setReason(editing.reason);
      setRangeEndDate(editing.endDate);
      if (editing.blockStartMinutes != null) {
        setBlockStart(minutesToTime(editing.blockStartMinutes));
      }
      if (editing.blockEndMinutes != null) {
        setBlockEnd(minutesToTime(editing.blockEndMinutes));
      }
      return;
    }
    setMode("day");
    setReason("");
    setRangeEndDate(selectedDateIso);
  }, [editing, selectedDateIso]);

  const editingRange = editing != null && editing.endDate > editing.date;

  function save() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error("El motivo es obligatorio");
      return;
    }

    if (mode === "range") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeEndDate)) {
        toast.error("Indica una fecha fin válida");
        return;
      }
      const rangeStart = editing?.date ?? selectedDateIso;
      if (rangeEndDate < rangeStart) {
        toast.error("La fecha fin debe ser igual o posterior al inicio");
        return;
      }
      onPendingChange(async () => {
        try {
          await setAbsence({
            id: editing?.id,
            personId,
            date: rangeStart,
            endDate: rangeEndDate,
            mode: "range",
            reason: trimmedReason,
          });
          toast.success(editing ? "Ausencia actualizada" : "Ausencia guardada");
          setReason("");
          setRangeEndDate(selectedDateIso);
          onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Error");
        }
      });
      return;
    }

    if (mode === "day") {
      onPendingChange(async () => {
        try {
          await setAbsence({
            id: editing?.id,
            personId,
            date: editing?.date ?? selectedDateIso,
            mode: "day",
            reason: trimmedReason,
          });
          toast.success(editing ? "Ausencia actualizada" : "Día completo registrado");
          setReason("");
          onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Error");
        }
      });
      return;
    }

    const bs = timeInputToMinutes(blockStart);
    const be = timeInputToMinutes(blockEnd);
    if (bs == null || be == null || be <= bs) {
      toast.error("Franja horaria inválida");
      return;
    }
    onPendingChange(async () => {
      try {
        await setAbsence({
          id: editing?.id,
          personId,
          date: editing?.date ?? selectedDateIso,
          mode: "block",
          reason: trimmedReason,
          blockStartMinutes: bs,
          blockEndMinutes: be,
        });
        toast.success(editing ? "Ausencia actualizada" : "Franja horaria guardada");
        setReason("");
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Las vacaciones personales del operario deben registrarse aquí como ausencias
        (motivo «{VACATION_ABSENCE_REASON}»), no como festivos de empresa.
      </p>

      <Tabs value={mode} onValueChange={(v) => setMode(v as AbsenceFormMode)}>
        <TabsList className="w-full">
          <TabsTrigger
            value="block"
            className="flex-1"
            disabled={pending || editingRange}
          >
            Franja
          </TabsTrigger>
          <TabsTrigger
            value="day"
            className="flex-1"
            disabled={pending || editingRange}
          >
            Día
          </TabsTrigger>
          <TabsTrigger
            value="range"
            className="flex-1"
            disabled={pending || (editing != null && !editingRange)}
          >
            Rango
          </TabsTrigger>
        </TabsList>

        <TabsContent value="block" className="space-y-3 mt-3">
          <div className="grid md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Inicio</Label>
              <Input
                type="time"
                value={blockStart}
                onChange={(e) => setBlockStart(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1">
              <Label>Fin</Label>
              <Input
                type="time"
                value={blockEnd}
                onChange={(e) => setBlockEnd(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Las horas se calculan automáticamente según la intersección con el horario laboral.
          </p>
        </TabsContent>

        <TabsContent value="day" className="space-y-2 mt-3">
          <p className="text-xs text-muted-foreground">
            Registra el día completo ({formatCivilIsoDate(editing?.date ?? selectedDateIso)})
            según el horario laboral configurado de la persona. Para vacaciones de un solo día,
            usa este modo con motivo «{VACATION_ABSENCE_REASON}».
          </p>
        </TabsContent>

        <TabsContent value="range" className="space-y-3 mt-3">
          <div className="grid md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Inicio</Label>
              <p className="text-sm font-medium tabular-nums">
                {formatCivilIsoDate(editing?.date ?? selectedDateIso)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {editing ? "Fecha de inicio del rango" : "Día seleccionado en el calendario"}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Fin</Label>
              <Input
                type="date"
                lang="es-ES"
                value={rangeEndDate}
                onChange={(e) => setRangeEndDate(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Crea una sola ausencia de día completo para todo el rango (inclusive). Si inicio y fin
            coinciden, equivale a un solo día.
          </p>
        </TabsContent>
      </Tabs>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label>Motivo *</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setReason(VACATION_ABSENCE_REASON)}
            disabled={pending}
          >
            Usar «{VACATION_ABSENCE_REASON}»
          </Button>
        </div>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. Vacaciones, médico, permiso…"
          disabled={pending}
          required
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={pending || !reason.trim()}>
          {editing ? "Guardar cambios" : "Guardar ausencia"}
        </Button>
        {editing && onCancelEdit ? (
          <Button type="button" variant="outline" onClick={onCancelEdit} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
