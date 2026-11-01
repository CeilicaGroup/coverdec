"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { setSaturdayWork } from "@/features/planning/saturday-actions";
import type { SaturdayWork } from "@/features/planning/saturday";

interface SaturdayPerson {
  id: string;
  label: string;
}

const DEFAULT_START = 8 * 60;
const DEFAULT_END = 14 * 60;

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, min] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (min ?? 0);
}

/** Sábado laborable de la semana: quién trabaja y en qué horario (se decide por entrega). */
export function SaturdayWorkButton({
  saturdayIso,
  current,
  people,
}: {
  saturdayIso: string;
  current: SaturdayWork | null;
  people: SaturdayPerson[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [start, setStart] = useState(minutesToTime(DEFAULT_START));
  const [end, setEnd] = useState(minutesToTime(DEFAULT_END));

  const dateLabel = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${saturdayIso}T00:00:00.000Z`));

  const openDialog = () => {
    setPersonIds(current?.personIds ?? []);
    setStart(minutesToTime(current?.startMinutes ?? DEFAULT_START));
    setEnd(minutesToTime(current?.endMinutes ?? DEFAULT_END));
    setOpen(true);
  };

  const save = (ids: string[]) => {
    startTransition(async () => {
      const result = await setSaturdayWork({
        dateIso: saturdayIso,
        personIds: ids,
        startMinutes: timeToMinutes(start),
        endMinutes: timeToMinutes(end),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        ids.length > 0
          ? `Sábado habilitado para ${ids.length} persona(s). Regenera el planning de la semana para usarlo.`
          : "Sábado quitado. Regenera el planning de la semana para aplicarlo.",
      );
      setOpen(false);
      router.refresh();
    });
  };

  const allSelected = people.length > 0 && personIds.length === people.length;

  return (
    <>
      <Button variant={current ? "default" : "outline"} size="sm" onClick={openDialog}>
        <CalendarPlus className="size-4" />
        {current ? `Sábado (${current.personIds.length})` : "Sábado"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Trabajar el {dateLabel}</DialogTitle>
            <DialogDescription>
              Elige quién trabaja este sábado. El planning solo pone tareas el sábado a estas
              personas y en este horario.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="saturday-start">Entrada</Label>
                <Input
                  id="saturday-start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-[120px]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="saturday-end">Salida</Label>
                <Input
                  id="saturday-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-[120px]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Personas ({personIds.length})</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPersonIds(allSelected ? [] : people.map((p) => p.id))}
                >
                  {allSelected ? "Ninguna" : "Todo el equipo"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-3 rounded-md border p-2">
                {people.map((person) => (
                  <label key={person.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={personIds.includes(person.id)}
                      onCheckedChange={(value) =>
                        setPersonIds((prev) =>
                          value ? [...prev, person.id] : prev.filter((id) => id !== person.id),
                        )
                      }
                    />
                    {person.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            {current ? (
              <Button variant="outline" disabled={pending} onClick={() => save([])}>
                Quitar sábado
              </Button>
            ) : null}
            <Button disabled={pending || personIds.length === 0} onClick={() => save(personIds)}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
