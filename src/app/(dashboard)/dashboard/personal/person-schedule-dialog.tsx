"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { savePersonWorkWindows } from "@/features/people/actions";
import { defaultWeeklyTemplate } from "@/features/planning/engine/slots/person-schedule";
import { toast } from "sonner";

const DAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
};

interface WindowRow {
  dayOfWeek: number;
  morningStart: string;
  morningEnd: string;
  hasAfternoon: boolean;
  afternoonStart: string;
  afternoonEnd: string;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, min] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (min ?? 0);
}

function templateToRows(): WindowRow[] {
  const template = defaultWeeklyTemplate();
  return template.map((day) => {
    const w = day.windows;
    return {
      dayOfWeek: day.dayOfWeek,
      morningStart: minutesToTime(w[0]?.startMinutes ?? 8 * 60),
      morningEnd: minutesToTime(w[0]?.endMinutes ?? 14 * 60),
      hasAfternoon: w.length >= 2,
      afternoonStart: minutesToTime(w[1]?.startMinutes ?? 15 * 60),
      afternoonEnd: minutesToTime(w[1]?.endMinutes ?? 17 * 60),
    };
  });
}

function dbWindowsToRows(
  windows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): WindowRow[] {
  if (windows.length === 0) return templateToRows();
  const byDay = new Map<number, typeof windows>();
  for (const w of windows) {
    const list = byDay.get(w.dayOfWeek) ?? [];
    list.push(w);
    byDay.set(w.dayOfWeek, list);
  }
  return [1, 2, 3, 4, 5].map((dow) => {
    const dayWindows = (byDay.get(dow) ?? []).sort(
      (a, b) => a.startMinutes - b.startMinutes,
    );
    return {
      dayOfWeek: dow,
      morningStart: minutesToTime(dayWindows[0]?.startMinutes ?? 8 * 60),
      morningEnd: minutesToTime(dayWindows[0]?.endMinutes ?? 14 * 60),
      hasAfternoon: dayWindows.length >= 2,
      afternoonStart: minutesToTime(dayWindows[1]?.startMinutes ?? 15 * 60),
      afternoonEnd: minutesToTime(dayWindows[1]?.endMinutes ?? 17 * 60),
    };
  });
}

export function PersonScheduleDialog({
  personId,
  personName,
  workWindows,
}: {
  personId: string;
  personName: string;
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<WindowRow[]>(() => dbWindowsToRows(workWindows));

  function updateRow(dow: number, patch: Partial<WindowRow>) {
    setRows((prev) =>
      prev.map((r) => (r.dayOfWeek === dow ? { ...r, ...patch } : r)),
    );
  }

  function submit() {
    const windows = rows.flatMap((r) => {
      const entries: { dayOfWeek: number; startMinutes: number; endMinutes: number }[] = [
        {
          dayOfWeek: r.dayOfWeek,
          startMinutes: timeToMinutes(r.morningStart),
          endMinutes: timeToMinutes(r.morningEnd),
        },
      ];
      if (r.hasAfternoon) {
        entries.push({
          dayOfWeek: r.dayOfWeek,
          startMinutes: timeToMinutes(r.afternoonStart),
          endMinutes: timeToMinutes(r.afternoonEnd),
        });
      }
      return entries;
    });
    startTransition(async () => {
      try {
        await savePersonWorkWindows({ personId, windows });
        toast.success("Horario guardado");
        setOpen(false);
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
            <Clock className="size-3" />
            Horario
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Horario — {personName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.dayOfWeek} className="rounded-md border p-3 space-y-2">
              <div className="text-xs font-semibold">{DAY_LABELS[r.dayOfWeek]}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <Label className="text-[10px]">Mañana inicio</Label>
                  <Input
                    type="time"
                    value={r.morningStart}
                    onChange={(e) =>
                      updateRow(r.dayOfWeek, { morningStart: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Mañana fin</Label>
                  <Input
                    type="time"
                    value={r.morningEnd}
                    onChange={(e) =>
                      updateRow(r.dayOfWeek, { morningEnd: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`has-afternoon-${r.dayOfWeek}`}
                  checked={r.hasAfternoon}
                  onCheckedChange={(checked) =>
                    updateRow(r.dayOfWeek, { hasAfternoon: checked === true })
                  }
                />
                <Label htmlFor={`has-afternoon-${r.dayOfWeek}`} className="text-xs cursor-pointer">
                  Jornada de tarde
                </Label>
              </div>
              {r.hasAfternoon && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Label className="text-[10px]">Tarde inicio</Label>
                    <Input
                      type="time"
                      value={r.afternoonStart}
                      onChange={(e) =>
                        updateRow(r.dayOfWeek, { afternoonStart: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">Tarde fin</Label>
                    <Input
                      type="time"
                      value={r.afternoonEnd}
                      onChange={(e) =>
                        updateRow(r.dayOfWeek, { afternoonEnd: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={submit} disabled={pending}>
            Guardar horario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
