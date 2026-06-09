"use client";

import { handleActionResult } from "@/lib/mutation-error";
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
import { formatAbsenceDetail } from "@/features/people/absence-display";
import {
  absenceCoversCivilIso,
  civilIsoDaysCoveredByAbsence,
  effectiveAbsenceHoursOnDay,
} from "@/features/people/absence-model";
import { AbsenceForm } from "@/features/people/absence-form";
import { deleteAbsence } from "@/features/people/actions";
import { createHoliday, deleteHoliday, updateHoliday } from "@/features/holidays/actions";
import { adminDeleteAttendanceSession, adminUpsertAttendanceSession, startAttendance, stopAttendance } from "@/features/attendance/actions";
import {
  civilIsoFromLocalDate,
  expandCivilIsoRange,
  formatCivilIsoDate,
  formatMonthYearEs,
  localDateFromCivilIso,
} from "@/lib/civil-date";

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
  endDate: string;
  hours: number;
  reason: string | null;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

function dayTooltipText(modifiers: Record<string, boolean>): string {
  const labels: string[] = [];
  if (modifiers.withSession) labels.push("Tiene fichajes");
  if (modifiers.withAbsence) labels.push("Tiene ausencia");
  if (modifiers.withHoliday) labels.push("Festivo de empresa");
  if (labels.length === 0) return "Día sin incidencias";
  return labels.join(" · ");
}

function toTimeValue(dateIso: string): string {
  return new Date(dateIso).toISOString().slice(11, 16);
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
  const [editingAbsenceId, setEditingAbsenceId] = useState<string | null>(null);
  const [holidayStartDate, setHolidayStartDate] = useState(civilIsoFromLocalDate(new Date()));
  const [holidayEndDate, setHolidayEndDate] = useState(civilIsoFromLocalDate(new Date()));
  const [holidayName, setHolidayName] = useState("");
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);

  const selectedIso = civilIsoFromLocalDate(selectedDate);
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
    () =>
      props.absences.filter(
        (a) =>
          a.personId === visiblePersonId &&
          absenceCoversCivilIso(
            {
              date: new Date(`${a.date}T00:00:00.000Z`),
              endDate: new Date(`${a.endDate}T00:00:00.000Z`),
            },
            selectedIso,
          ),
      ),
    [props.absences, visiblePersonId, selectedIso],
  );

  const editingAbsence = useMemo(
    () =>
      editingAbsenceId
        ? props.absences.find((a) => a.id === editingAbsenceId) ?? null
        : null,
    [editingAbsenceId, props.absences],
  );
  const absencesForMonth = useMemo(
    () =>
      props.absences
        .filter((a) => {
          if (a.personId !== visiblePersonId) return false;
          const month = selectedIso.slice(0, 7);
          return (
            a.date.slice(0, 7) === month ||
            a.endDate.slice(0, 7) === month ||
            (a.date.slice(0, 7) < month && a.endDate.slice(0, 7) > month)
          );
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
    [props.absences, visiblePersonId, selectedIso],
  );

  const personAbsenceIsos = useMemo(() => {
    const isos = new Set<string>();
    for (const a of props.absences.filter((row) => row.personId === visiblePersonId)) {
      for (const iso of civilIsoDaysCoveredByAbsence({
        date: new Date(`${a.date}T00:00:00.000Z`),
        endDate: new Date(`${a.endDate}T00:00:00.000Z`),
      })) {
        isos.add(iso);
      }
    }
    return isos;
  }, [props.absences, visiblePersonId]);

  const holidayDays = useMemo(() => {
    const days: Date[] = [];
    for (const row of props.holidays) {
      for (const iso of expandCivilIsoRange(row.startDate, row.endDate)) {
        if (personAbsenceIsos.has(iso)) continue;
        days.push(localDateFromCivilIso(iso));
      }
    }
    return days;
  }, [props.holidays, personAbsenceIsos]);

  const sessionDays = useMemo(
    () => props.sessions.filter((s) => s.personId === visiblePersonId).map((s) => new Date(s.startedAt)),
    [props.sessions, visiblePersonId],
  );
  const absenceDays = useMemo(() => {
    const days: Date[] = [];
    for (const a of props.absences.filter((row) => row.personId === visiblePersonId)) {
      for (const iso of civilIsoDaysCoveredByAbsence({
        date: new Date(`${a.date}T00:00:00.000Z`),
        endDate: new Date(`${a.endDate}T00:00:00.000Z`),
      })) {
        days.push(localDateFromCivilIso(iso));
      }
    }
    return days;
  }, [props.absences, visiblePersonId]);

  const todayIso = civilIsoFromLocalDate(new Date());
  const visiblePerson = props.people.find((p) => p.id === visiblePersonId) ?? null;
  const todayWeekday = (() => {
    const d = new Date().getDay();
    if (d === 0 || d === 6) return 5;
    return d;
  })();

  const targetTodayMinutes = useMemo(() => {
    if (!visiblePerson) return 0;
    const workMinutes = visiblePerson.workWindows
      .filter((w) => w.dayOfWeek === todayWeekday)
      .reduce((acc, w) => acc + Math.max(0, w.endMinutes - w.startMinutes), 0);
    const absenceMinutes = props.absences
      .filter(
        (a) =>
          a.personId === visiblePerson.id &&
          absenceCoversCivilIso(
            {
              date: new Date(`${a.date}T00:00:00.000Z`),
              endDate: new Date(`${a.endDate}T00:00:00.000Z`),
            },
            todayIso,
          ),
      )
      .reduce((acc, a) => {
        const hours = effectiveAbsenceHoursOnDay(
          {
            date: new Date(`${a.date}T00:00:00.000Z`),
            endDate: new Date(`${a.endDate}T00:00:00.000Z`),
            hours: a.hours,
            blockStartMinutes: a.blockStartMinutes,
            blockEndMinutes: a.blockEndMinutes,
          },
          todayIso,
          visiblePerson.workWindows,
        );
        return acc + Math.round(hours * 60);
      }, 0);
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
              onSelect={(d) => {
                if (!d) return;
                setSelectedDate(d);
                setEditingAbsenceId(null);
              }}
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
              <span>Festivo de empresa</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Fichaje del día {formatCivilIsoDate(selectedIso)}</CardTitle>
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
                        const result = await startAttendance();
                        const outcome = handleActionResult("fichaje.start", result);
                        if (!outcome.success) {
                          toast.error(outcome.message);
                          return;
                        }
                        toast.success("Fichaje iniciado");
                        router.refresh();
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
                        const result = await stopAttendance({ sessionId: props.openSession?.id });
                        const outcome = handleActionResult("fichaje.stop", result);
                        if (!outcome.success) {
                          toast.error(outcome.message);
                          return;
                        }
                        toast.success("Fichaje finalizado");
                        router.refresh();
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
                        const result = await adminUpsertAttendanceSession({
                            personId: visiblePersonId!,
                            date: selectedIso,
                            startTime,
                            endTime,
                          });
                        const outcome = handleActionResult("fichaje.adminUpsert", result);
                        if (!outcome.success) {
                          toast.error(outcome.message);
                          return;
                        }
                        toast.success("Franja de fichaje guardada");
                        router.refresh();
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
                            const result = await adminDeleteAttendanceSession({
                              sessionId: session.id,
                            });
                            const outcome = handleActionResult("fichaje.adminDelete", result);
                            if (!outcome.success) {
                              toast.error(outcome.message);
                              return;
                            }
                            toast.success("Fichaje eliminado");
                            router.refresh();
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
              <CardTitle>Ausencias</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AbsenceForm
                key={`${editingAbsenceId ?? "new"}-${selectedIso}`}
                personId={visiblePersonId}
                selectedDateIso={editingAbsence?.date ?? selectedIso}
                editing={
                  editingAbsence
                    ? {
                        id: editingAbsence.id,
                        date: editingAbsence.date,
                        endDate: editingAbsence.endDate,
                        hours: editingAbsence.hours,
                        reason: editingAbsence.reason ?? "",
                        blockStartMinutes: editingAbsence.blockStartMinutes,
                        blockEndMinutes: editingAbsence.blockEndMinutes,
                      }
                    : null
                }
                pending={pending}
                onPendingChange={(fn) => startTransition(fn)}
                onSaved={() => {
                  setEditingAbsenceId(null);
                  router.refresh();
                }}
                onCancelEdit={() => setEditingAbsenceId(null)}
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {absencesForDay.map((absence) => (
                  <p key={absence.id} className="text-sm text-muted-foreground">
                    {formatAbsenceDetail(absence)}
                  </p>
                ))}
              </div>
              <div className="border-t pt-3">
                <p className="text-sm font-medium mb-2">
                  Ausencias de {formatMonthYearEs(selectedIso)}
                </p>
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
                          {formatAbsenceDetail(absence)}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingAbsenceId(absence.id);
                              setSelectedDate(localDateFromCivilIso(absence.date));
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
                                const result = await deleteAbsence({
                                    id: absence.id,
                                    personId: visiblePersonId,
                                    date: absence.date,
                                  });
                                const outcome = handleActionResult("fichaje.absence.delete", result);
                                if (!outcome.success) {
                                  toast.error(outcome.message);
                                  return;
                                }
                                toast.success("Ausencia eliminada");
                                if (editingAbsenceId === absence.id) setEditingAbsenceId(null);
                                router.refresh();
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
              <CardTitle>Festivos de empresa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Calendario laboral común (navidad, puente, etc.). Las vacaciones de cada operario
                se registran como ausencias, no aquí.
              </p>
              <div className="grid md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Inicio</Label>
                  <Input
                    type="date"
                    lang="es-ES"
                    value={holidayStartDate}
                    onChange={(e) => setHolidayStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Fin</Label>
                  <Input
                    type="date"
                    lang="es-ES"
                    value={holidayEndDate}
                    onChange={(e) => setHolidayEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={pending || !holidayName.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      const result = editingHolidayId
                        ? await updateHoliday({
                            id: editingHolidayId,
                            startDate: holidayStartDate,
                            endDate: holidayEndDate,
                            name: holidayName.trim(),
                          })
                        : await createHoliday({
                            startDate: holidayStartDate,
                            endDate: holidayEndDate,
                            name: holidayName.trim(),
                          });
                      const outcome = handleActionResult(
                        editingHolidayId ? "fichaje.holiday.update" : "fichaje.holiday.create",
                        result,
                      );
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success(editingHolidayId ? "Festivo actualizado" : "Festivo creado");
                      setEditingHolidayId(null);
                      setHolidayName("");
                      setHolidayStartDate(selectedIso);
                      setHolidayEndDate(selectedIso);
                      router.refresh();
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
                      {formatCivilIsoDate(holiday.startDate)}
                      {holiday.startDate !== holiday.endDate
                        ? ` — ${formatCivilIsoDate(holiday.endDate)}`
                        : ""}{" "}
                      · {holiday.name}
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
                            const result = await deleteHoliday({ id: holiday.id });
                            const outcome = handleActionResult("fichaje.holiday.delete", result);
                            if (!outcome.success) {
                              toast.error(outcome.message);
                              return;
                            }
                            toast.success("Festivo eliminado");
                            router.refresh();
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
