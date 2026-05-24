"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonAvatar } from "@/components/person-avatar";
import { ProcessBadge } from "@/components/process-badge";
import { Badge } from "@/components/ui/badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { savePerson, deletePerson } from "@/features/people/actions";
import { PersonScheduleDialog } from "./person-schedule-dialog";
import { PersonAbsenceDialog } from "./person-absence-dialog";
import type { Person, PersonSpecialty } from "@/generated/prisma";
import type { ProcessCode } from "@/types/process";

interface ProcessDefOption {
  code: ProcessCode;
  label: string;
}

interface WorkWindowRow {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

interface AbsenceRow {
  date: string;
  hours: number;
  reason: string | null;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

type PersonWithSpecs = Person & {
  specialties: PersonSpecialty[];
  canHardDelete: boolean;
  workWindows: WorkWindowRow[];
  absences: AbsenceRow[];
};

type SpecMode = "ninguno" | "responsable" | "apoyo" | "otra";

function modeFromSpecialty(s: PersonSpecialty): SpecMode {
  if (s.isPrimary) return "responsable";
  if (s.isFallback) return "apoyo";
  return "otra";
}

function emptySpecMap(processDefs: ProcessDefOption[]): Record<string, SpecMode> {
  return Object.fromEntries(processDefs.map((d) => [d.code, "ninguno" as SpecMode]));
}

export function PersonalTeamClient({
  people,
  processDefs,
  canManage,
}: {
  people: PersonWithSpecs[];
  processDefs: ProcessDefOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const [iniciales, setIniciales] = useState("");
  const [color, setColor] = useState("#64748b");
  const [capacityHours, setCapacityHours] = useState("8");
  const [hourlyRate, setHourlyRate] = useState("14.75");
  const [overtimeHourlyRate, setOvertimeHourlyRate] = useState("22.13");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [specMap, setSpecMap] = useState<Record<string, SpecMode>>(() =>
    emptySpecMap(processDefs),
  );

  const activeCount = useMemo(() => people.filter((p) => p.isActive).length, [people]);

  function openCreate() {
    setEditingId(undefined);
    setNombre("");
    setIniciales("");
    setColor("#64748b");
    setCapacityHours("8");
    setHourlyRate("14.75");
    setOvertimeHourlyRate("22.13");
    setNotes("");
    setIsActive(true);
    setSpecMap(emptySpecMap(processDefs));
    setOpen(true);
  }

  function openEdit(p: PersonWithSpecs) {
    setEditingId(p.id);
    setNombre(p.nombre);
    setIniciales(p.iniciales);
    setColor(p.color);
    setCapacityHours(String(p.capacityHours));
    setHourlyRate(String(p.hourlyRate));
    setOvertimeHourlyRate(String(p.overtimeHourlyRate));
    setNotes(p.notes ?? "");
    setIsActive(p.isActive);
    const next = emptySpecMap(processDefs);
    for (const s of p.specialties) {
      next[s.process] = modeFromSpecialty(s);
    }
    setSpecMap(next);
    setOpen(true);
  }

  function setModeForProcess(code: ProcessCode, mode: SpecMode) {
    setSpecMap((prev) => ({ ...prev, [code]: mode }));
  }

  function submit() {
    startTransition(async () => {
      try {
        const cap = Number(capacityHours);
        const rate = Number(hourlyRate);
        const otRate = Number(overtimeHourlyRate);
        if (Number.isNaN(cap) || cap < 1 || cap > 24) {
          toast.error("Capacidad diaria inválida (1–24 h)");
          return;
        }
        if (Number.isNaN(rate) || rate < 0 || Number.isNaN(otRate) || otRate < 0) {
          toast.error("Tarifas horarias inválidas");
          return;
        }
        const specialties = processDefs
          .map((d) => {
            const m = specMap[d.code] ?? "ninguno";
            if (m === "ninguno") return null;
            return {
              process: d.code,
              mode: m,
            } as const;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        await savePerson({
          id: editingId,
          nombre,
          iniciales,
          color,
          capacityHours: cap,
          hourlyRate: rate,
          overtimeHourlyRate: otRate,
          notes: notes.trim() || undefined,
          isActive,
          specialties,
        });
        toast.success(editingId ? "Persona actualizada" : "Persona creada");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  function formatActionError(err: unknown): string {
    if (err instanceof Error && err.message.startsWith("ARCHIVE_ONLY:")) {
      return err.message.replace(/^ARCHIVE_ONLY:\s*/, "").trim();
    }
    return err instanceof Error ? err.message : "Error";
  }

  function onDeletePerson(p: PersonWithSpecs) {
    if (!p.canHardDelete) {
      toast.error(
        "Hay planning o un usuario vinculado. Solo puedes desactivar la persona desde Editar.",
      );
      return;
    }
    if (
      !globalThis.confirm(
        `¿Eliminar definitivamente a ${p.nombre} (${p.iniciales})? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await deletePerson({ personId: p.id });
        toast.success("Persona eliminada");
        router.refresh();
      } catch (e) {
        toast.error(formatActionError(e));
      }
    });
  }

  return (
    <>
      <PageHeader
        title="Personal"
        description={`${activeCount} activos · ${people.length} en total`}
        actions={
          canManage ? (
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="size-3.5" />
              Nueva persona
            </Button>
          ) : undefined
        }
      />

      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {people.map((p) => {
          const primary = p.specialties.filter((s) => s.isPrimary);
          const fallback = p.specialties.filter((s) => s.isFallback);
          const others = p.specialties.filter((s) => !s.isPrimary && !s.isFallback);
          return (
            <Card
              key={p.id}
              className={!p.isActive ? "opacity-70 border-dashed" : undefined}
            >
              <CardHeader
                className="py-3 border-b"
                style={{
                  background: `${p.color}10`,
                  borderColor: `${p.color}40`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <PersonAvatar iniciales={p.iniciales} color={p.color} size={42} />
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{p.nombre}</CardTitle>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {!p.isActive ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Inactiva
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {p.notes ?? ""}
                      </div>
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <PersonScheduleDialog
                        personId={p.id}
                        personName={p.nombre}
                        workWindows={p.workWindows}
                      />
                      <PersonAbsenceDialog
                        personId={p.id}
                        personName={p.nombre}
                        absences={p.absences}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(p)}
                        aria-label="Editar persona"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive disabled:opacity-40"
                        disabled={!p.canHardDelete}
                        onClick={() => onDeletePerson(p)}
                        title={
                          p.canHardDelete
                            ? "Eliminar del todo"
                            : "Solo desactivar: hay planning o usuario vinculado"
                        }
                        aria-label="Eliminar persona"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 py-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Capacidad:</span>
                  <Badge variant="outline" className="font-mono">
                    {p.capacityHours}h/día
                  </Badge>
                </div>
                {primary.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
                      Responsable
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {primary.map((s) => (
                        <ProcessBadge key={s.id} code={s.process} />
                      ))}
                    </div>
                  </div>
                )}
                {fallback.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
                      Apoyo / sustituto
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {fallback.map((s) => (
                        <ProcessBadge key={s.id} code={s.process} />
                      ))}
                    </div>
                  </div>
                )}
                {others.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
                      Otras tareas
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {others.map((s) => (
                        <ProcessBadge key={s.id} code={s.process} />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar persona" : "Nueva persona"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label>Nombre completo</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={pending} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Iniciales</Label>
                <Input
                  value={iniciales}
                  onChange={(e) => setIniciales(e.target.value.toUpperCase())}
                  disabled={pending || Boolean(editingId)}
                  className="font-mono"
                  maxLength={12}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={pending}
                  className="h-9 p-1 cursor-pointer"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Horas útiles por día</Label>
              <Input
                inputMode="decimal"
                value={capacityHours}
                onChange={(e) => setCapacityHours(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Sueldo €/h</Label>
                <Input
                  inputMode="decimal"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label>Extra €/h</Label>
                <Input
                  inputMode="decimal"
                  value={overtimeHourlyRate}
                  onChange={(e) => setOvertimeHourlyRate(e.target.value)}
                  disabled={pending}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={pending}
              />
            </div>
            {editingId ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="person-active"
                  checked={isActive}
                  onCheckedChange={(v) => setIsActive(v === true)}
                  disabled={pending}
                />
                <Label htmlFor="person-active" className="font-normal cursor-pointer">
                  Persona activa
                </Label>
              </div>
            ) : null}
            <div className="space-y-2 border-t pt-3">
              <Label>Especialidades por proceso</Label>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {processDefs.map((d) => (
                  <div
                    key={d.code}
                    className="grid grid-cols-[1fr_140px] gap-2 items-center text-sm"
                  >
                    <span className="text-muted-foreground truncate">{d.label}</span>
                    <Select
                      value={specMap[d.code] ?? "ninguno"}
                      onValueChange={(v) => setModeForProcess(d.code, v as SpecMode)}
                      disabled={pending}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Ninguna" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ninguno">Ninguna</SelectItem>
                        <SelectItem value="responsable">Responsable</SelectItem>
                        <SelectItem value="apoyo">Apoyo</SelectItem>
                        <SelectItem value="otra">Otra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || !nombre.trim() || !iniciales.trim()}
            >
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
