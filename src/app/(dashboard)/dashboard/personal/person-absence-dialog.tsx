"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAbsence } from "@/features/people/actions";
import { formatShortDate } from "@/lib/format";
import { toast } from "sonner";

interface AbsenceRow {
  date: string;
  hours: number;
  reason: string | null;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

function minutesToTimeLabel(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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

function formatAbsenceLine(a: AbsenceRow): string {
  const dateLabel = formatShortDate(new Date(`${a.date}T00:00:00.000Z`));
  const block =
    a.blockStartMinutes != null &&
    a.blockEndMinutes != null &&
    a.blockEndMinutes > a.blockStartMinutes;
  if (block) {
    return `${dateLabel} — ${minutesToTimeLabel(a.blockStartMinutes!)}–${minutesToTimeLabel(a.blockEndMinutes!)} (${a.hours}h)`;
  }
  return `${dateLabel} — ${a.hours}h`;
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
  const [hours, setHours] = useState("8");
  const [reason, setReason] = useState("");
  const [blockMode, setBlockMode] = useState(false);
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("13:00");

  const sorted = useMemo(
    () => [...absences].sort((a, b) => a.date.localeCompare(b.date)),
    [absences],
  );

  function save() {
    if (!selected) {
      toast.error("Selecciona una fecha");
      return;
    }
    const iso = selected.toISOString().slice(0, 10);

    if (blockMode) {
      const bs = timeInputToMinutes(blockStart);
      const be = timeInputToMinutes(blockEnd);
      if (bs == null || be == null) {
        toast.error("Horas de franja inválidas (HH:MM)");
        return;
      }
      if (be <= bs) {
        toast.error("La franja debe terminar después del inicio");
        return;
      }
      startTransition(async () => {
        try {
          await setAbsence({
            personId,
            date: iso,
            hours: 0,
            reason: reason.trim() || undefined,
            blockStartMinutes: bs,
            blockEndMinutes: be,
          });
          toast.success("Franja guardada");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Error");
        }
      });
      return;
    }

    const h = Number(hours);
    if (Number.isNaN(h) || h < 0 || h > 24) {
      toast.error("Horas inválidas (0–24)");
      return;
    }
    startTransition(async () => {
      try {
        await setAbsence({
          personId,
          date: iso,
          hours: h,
          reason: reason.trim() || undefined,
        });
        toast.success(h <= 0 ? "Ausencia eliminada" : "Ausencia guardada");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function remove(dateIso: string) {
    startTransition(async () => {
      try {
        await setAbsence({ personId, date: dateIso, hours: 0 });
        toast.success("Ausencia eliminada");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
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
      <DialogContent className="max-w-md">
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
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="block-mode"
                checked={blockMode}
                onCheckedChange={(v) => setBlockMode(v === true)}
              />
              <Label htmlFor="block-mode" className="text-sm font-normal cursor-pointer">
                Franja horaria prohibida (dentro del día laboral)
              </Label>
            </div>
            {blockMode ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Inicio</Label>
                  <Input
                    type="time"
                    value={blockStart}
                    onChange={(e) => setBlockStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fin</Label>
                  <Input
                    type="time"
                    value={blockEnd}
                    onChange={(e) => setBlockEnd(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Horas ausente (0 = quitar)</Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              Guardar día
            </Button>
          </div>
        </div>
        {sorted.length > 0 ? (
          <ul className="text-xs space-y-1 max-h-32 overflow-y-auto border-t pt-2">
            {sorted.map((a) => (
              <li key={a.date} className="flex justify-between items-center gap-2">
                <span>
                  {formatAbsenceLine(a)}
                  {a.reason ? ` — ${a.reason}` : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-destructive"
                  disabled={pending}
                  onClick={() => remove(a.date)}
                >
                  Quitar
                </Button>
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
