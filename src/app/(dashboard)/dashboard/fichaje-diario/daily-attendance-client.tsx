"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { FestivoRow } from "../festivos/festivos-client";
import { setAbsence } from "@/features/people/actions";
import { createHoliday, deleteHoliday, updateHoliday } from "@/features/holidays/actions";
import { adminDeleteAttendanceSession, adminUpsertAttendanceSession, startAttendance, stopAttendance } from "@/features/attendance/actions";

interface PersonRow {
  id: string;
  userId: string | null;
  name: string;
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
}

interface SessionRow {
  id: string;
  userId: string;
  personId: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  notes: string | null;
}

interface AbsenceRow {
  id: string;
  personId: string;
  date: string;
  hours: number;
  reason: string | null;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

function dayTooltipText(modifiers: Record<string, boolean>): string {
  const labels: string[] = [];
  if (modifiers.withSession) labels.push("Tiene fichajes");
  if (modifiers.withAbsence) labels.push("Tiene ausencia");
  if (modifiers.withHoliday) labels.push("Es festivo/vacación");
  if (labels.length === 0) return "Día sin incidencias";
  return labels.join(" · ");
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeValue(dateIso: string): string {
  return new Date(dateIso).toISOString().slice(11, 16);
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

function formatHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(safe / 3600)).padStart(2, "0");
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function DailyAttendanceClient(props: {
  canManage: boolean;
  currentUserId: string;
  currentPersonId: string | null;
  people: PersonRow[];
  sessions: SessionRow[];
  absences: AbsenceRow[];
  holidays: FestivoRow[];
  openSession: { id: string; startedAt: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [personId, setPersonId] = useState<string>(props.currentPersonId ?? props.people[0]?.id ?? "");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("14:00");
  const [absenceReason, setAbsenceReason] = useState("");
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("13:00");
  const [editingAbsenceId, setEditingAbsenceId] = useState<string | null>(null);
  const [holidayStartDate, setHolidayStartDate] = useState(isoDay(new Date()));
  const [holidayEndDate, setHolidayEndDate] = useState(isoDay(new Date()));
  const [holidayName, setHolidayName] = useState("");
  const [holidayRegion, setHolidayRegion] = useState("");
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);

  const selectedIso = isoDay(selectedDate);
  const visiblePersonId = props.canManage ? personId : props.currentPersonId;
  const selectedPersonName = props.people.find((p) => p.id === personId)?.name ?? "Selecciona persona";
  const holidaysSorted = useMemo(
    () => [...props.holidays].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [props.holidays],
  );

  const sessionsForDay = useMemo(() => {
    return props.sessions
      .filter((s) => s.personId === visiblePersonId && s.startedAt.slice(0, 10) === selectedIso)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [props.sessions, selectedIso, visiblePersonId]);

  const absencesForDay = useMemo(
    () => props.absences.filter((a) => a.personId === visiblePersonId && a.date === selectedIso),
    [props.absences, visiblePersonId, selectedIso],
  );
  const monthPrefix = selectedIso.slice(0, 7);
  const absencesForMonth = useMemo(
    () =>
      props.absences
        .filter((a) => a.personId === visiblePersonId && a.date.startsWith(monthPrefix))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [props.absences, visiblePersonId, monthPrefix],
  );

  const holidayDays = useMemo(() => {
    const days: Date[] = [];
    for (const row of props.holidays) {
      const start = new Date(`${row.startDate}T00:00:00.000Z`).getTime();
      const end = new Date(`${row.endDate}T00:00:00.000Z`).getTime();
      for (let t = start; t <= end; t += 86_400_000) {
        days.push(new Date(t));
      }
    }
    return days;
  }, [props.holidays]);

  const sessionDays = useMemo(
    () => props.sessions.filter((s) => s.personId === visiblePersonId).map((s) => new Date(s.startedAt)),
    [props.sessions, visiblePersonId],
  );
  const absenceDays = useMemo(
    () => props.absences.filter((a) => a.personId === visiblePersonId).map((a) => new Date(`${a.date}T00:00:00.000Z`)),
    [props.absences, visiblePersonId],
  );

  const todayIso = isoDay(new Date());
  const visiblePerson = props.people.find((p) => p.id === visiblePersonId) ?? null;
  const todayWeekday = (() => {
    const d = new Date().getUTCDay();
    return d === 0 ? 7 : d;
  })();

  const targetTodayMinutes = useMemo(() => {
    if (!visiblePerson) return 0;
    const workMinutes = visiblePerson.workWindows
      .filter((w) => w.dayOfWeek === todayWeekday)
      .reduce((acc, w) => acc + Math.max(0, w.endMinutes - w.startMinutes), 0);
    const absenceMinutes = props.absences
      .filter((a) => a.personId === visiblePerson.id && a.date === todayIso)
      .reduce((acc, a) => acc + Math.round(a.hours * 60), 0);
    return Math.max(0, workMinutes - absenceMinutes);
  }, [props.absences, todayIso, todayWeekday, visiblePerson]);

  const workedTodaySeconds = useMemo(() => {
    if (!visiblePerson) return 0;
    return props.sessions
      .filter((s) => s.personId === visiblePerson.id && s.startedAt.slice(0, 10) === todayIso)
      .reduce((acc, s) => {
        if (s.endedAt) {
          return acc + Math.max(0, Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000));
        }
        return acc + Math.max(0, Math.round((nowMs - new Date(s.startedAt).getTime()) / 1000));
      }, 0);
  }, [nowMs, props.sessions, todayIso, visiblePerson]);

  useEffect(() => {
    if (props.openSession == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.openSession]);

  const targetTodaySeconds = Math.max(0, targetTodayMinutes * 60);

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Calendario</CardTitle>
          {props.canManage ? (
            <Select value={personId} onValueChange={(value) => value && setPersonId(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona persona">{selectedPersonName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {props.people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <Calendar
              mode="single"
              className="[--cell-size:--spacing(10)]"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedDate(d)}
              modifiers={{
                withSession: sessionDays,
                withAbsence: absenceDays,
                withHoliday: holidayDays,
              }}
              modifiersClassNames={{
                withSession: "bg-primary/20",
                withAbsence: "bg-destructive/20",
                withHoliday: "bg-amber-500/20",
              }}
              components={{
                DayButton: ({ modifiers, ...dayProps }) => (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span>
                          <CalendarDayButton modifiers={modifiers} {...dayProps} />
                        </span>
                      }
                    />
                    <TooltipContent>
                      <p>{dayTooltipText(modifiers as Record<string, boolean>)}</p>
                    </TooltipContent>
                  </Tooltip>
                ),
              }}
            />
          </TooltipProvider>
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-primary/20 border border-primary/40" />
              <span>Día con fichajes</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-destructive/20 border border-destructive/40" />
              <span>Día con ausencia</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-amber-500/20 border border-amber-500/40" />
              <span>Festivo / vacaciones</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Fichaje del día {selectedIso}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!props.canManage ? (
              <div className="space-y-4">
                <div className="rounded-lg border p-5">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Tiempo actual / tiempo objetivo
                  </p>
                  <p className="font-mono text-5xl md:text-6xl font-bold tabular-nums">
                    {formatHms(workedTodaySeconds)} / {formatHms(targetTodaySeconds)}
                  </p>
                  <div className="mt-5 flex gap-2">
                  <Button
                    disabled={pending || props.openSession != null}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await startAttendance();
                          toast.success("Fichaje iniciado");
                          router.refresh();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Error");
                        }
                      })
                    }
                  >
                    <Play className="size-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={pending || props.openSession == null}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await stopAttendance({ sessionId: props.openSession?.id });
                          toast.success("Fichaje finalizado");
                          router.refresh();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Error");
                        }
                      })
                    }
                  >
                    <Pause className="size-4" />
                  </Button>
                </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>Inicio</Label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Fin</Label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-end">
                  <Button
                    disabled={pending || !visiblePersonId}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await adminUpsertAttendanceSession({
                            personId: visiblePersonId!,
                            date: selectedIso,
                            startTime,
                            endTime,
                          });
                          toast.success("Franja de fichaje guardada");
                          router.refresh();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Error");
                        }
                      })
                    }
                  >
                    Añadir franja
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {sessionsForDay.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin fichajes para este día.</p>
              ) : (
                sessionsForDay.map((session) => (
                  <div key={session.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <span>
                      {toTimeValue(session.startedAt)} - {session.endedAt ? toTimeValue(session.endedAt) : "abierto"} ·{" "}
                      {session.minutes ?? 0} min
                    </span>
                    {props.canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          startTransition(async () => {
                            try {
                              await adminDeleteAttendanceSession({ sessionId: session.id });
                              toast.success("Fichaje eliminado");
                              router.refresh();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Error");
                            }
                          })
                        }
                      >
                        Eliminar
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {props.canManage && visiblePersonId ? (
          <Card>
            <CardHeader>
              <CardTitle>Ausencias del día</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>Inicio</Label>
                  <Input type="time" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Fin</Label>
                  <Input type="time" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Motivo</Label>
                  <Input value={absenceReason} onChange={(e) => setAbsenceReason(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const bs = timeInputToMinutes(blockStart);
                        const be = timeInputToMinutes(blockEnd);
                        if (bs == null || be == null || be <= bs) {
                          throw new Error("Franja inválida para ausencia.");
                        }
                        await setAbsence({
                          id: editingAbsenceId ?? undefined,
                          personId: visiblePersonId,
                          date: selectedIso,
                          hours: 0,
                          reason: absenceReason || undefined,
                          blockStartMinutes: bs,
                          blockEndMinutes: be,
                        });
                        toast.success("Ausencia guardada");
                        setEditingAbsenceId(null);
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Error");
                      }
                    })
                  }
                >
                  Guardar ausencia
                </Button>
                {editingAbsenceId ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingAbsenceId(null);
                      setAbsenceReason("");
                    }}
                  >
                    Cancelar edición
                  </Button>
                ) : null}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {absencesForDay.map((absence) => (
                  <p key={absence.id} className="text-sm text-muted-foreground">
                    {absence.blockStartMinutes != null && absence.blockEndMinutes != null
                      ? `${String(Math.floor(absence.blockStartMinutes / 60)).padStart(2, "0")}:${String(absence.blockStartMinutes % 60).padStart(2, "0")} - ${String(Math.floor(absence.blockEndMinutes / 60)).padStart(2, "0")}:${String(absence.blockEndMinutes % 60).padStart(2, "0")} (${absence.hours}h)`
                      : `${absence.hours}h`}
                    {absence.reason ? ` · ${absence.reason}` : ""}
                  </p>
                ))}
              </div>
              <div className="border-t pt-3">
                <p className="text-sm font-medium mb-2">Ausencias del mes ({monthPrefix})</p>
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {absencesForMonth.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin ausencias registradas este mes.</p>
                  ) : (
                    absencesForMonth.map((absence) => (
                      <div
                        key={`month-${absence.id}`}
                        className="flex items-center justify-between rounded border p-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {absence.date} ·{" "}
                          {absence.blockStartMinutes != null && absence.blockEndMinutes != null
                            ? `${String(Math.floor(absence.blockStartMinutes / 60)).padStart(2, "0")}:${String(absence.blockStartMinutes % 60).padStart(2, "0")} - ${String(Math.floor(absence.blockEndMinutes / 60)).padStart(2, "0")}:${String(absence.blockEndMinutes % 60).padStart(2, "0")} (${absence.hours}h)`
                            : `${absence.hours}h`}
                          {absence.reason ? ` · ${absence.reason}` : ""}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingAbsenceId(absence.id);
                              setSelectedDate(new Date(`${absence.date}T00:00:00.000Z`));
                              setAbsenceReason(absence.reason ?? "");
                              if (absence.blockStartMinutes != null && absence.blockEndMinutes != null) {
                                setBlockStart(
                                  `${String(Math.floor(absence.blockStartMinutes / 60)).padStart(2, "0")}:${String(absence.blockStartMinutes % 60).padStart(2, "0")}`,
                                );
                                setBlockEnd(
                                  `${String(Math.floor(absence.blockEndMinutes / 60)).padStart(2, "0")}:${String(absence.blockEndMinutes % 60).padStart(2, "0")}`,
                                );
                              }
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              startTransition(async () => {
                                try {
                                  await setAbsence({
                                    personId: visiblePersonId,
                                    date: absence.date,
                                    hours: 0,
                                  });
                                  toast.success("Ausencia eliminada");
                                  if (editingAbsenceId === absence.id) setEditingAbsenceId(null);
                                  router.refresh();
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : "Error");
                                }
                              })
                            }
                          >
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {props.canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Vacaciones / festivos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Inicio</Label>
                  <Input type="date" value={holidayStartDate} onChange={(e) => setHolidayStartDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Fin</Label>
                  <Input type="date" value={holidayEndDate} onChange={(e) => setHolidayEndDate(e.target.value)} />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Nombre</Label>
                  <Input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Región</Label>
                  <Input value={holidayRegion} onChange={(e) => setHolidayRegion(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={pending || !holidayName.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        if (editingHolidayId) {
                          await updateHoliday({
                            id: editingHolidayId,
                            startDate: holidayStartDate,
                            endDate: holidayEndDate,
                            name: holidayName.trim(),
                            region: holidayRegion.trim() || undefined,
                          });
                          toast.success("Festivo actualizado");
                        } else {
                          await createHoliday({
                            startDate: holidayStartDate,
                            endDate: holidayEndDate,
                            name: holidayName.trim(),
                            region: holidayRegion.trim() || undefined,
                          });
                          toast.success("Festivo creado");
                        }
                        setEditingHolidayId(null);
                        setHolidayName("");
                        setHolidayRegion("");
                        setHolidayStartDate(selectedIso);
                        setHolidayEndDate(selectedIso);
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Error");
                      }
                    })
                  }
                >
                  {editingHolidayId ? "Guardar cambios" : "Añadir festivo"}
                </Button>
                {editingHolidayId ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingHolidayId(null);
                      setHolidayName("");
                      setHolidayRegion("");
                    }}
                  >
                    Cancelar
                  </Button>
                ) : null}
              </div>
              <div className="max-h-56 overflow-y-auto space-y-2">
                {holidaysSorted.map((holiday) => (
                  <div key={holiday.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <span>
                      {holiday.startDate} - {holiday.endDate} · {holiday.name}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingHolidayId(holiday.id);
                          setHolidayStartDate(holiday.startDate);
                          setHolidayEndDate(holiday.endDate);
                          setHolidayName(holiday.name);
                          setHolidayRegion(holiday.region);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          startTransition(async () => {
                            try {
                              await deleteHoliday({ id: holiday.id });
                              toast.success("Festivo eliminado");
                              router.refresh();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Error");
                            }
                          })
                        }
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

      </div>
    </div>
  );
}
