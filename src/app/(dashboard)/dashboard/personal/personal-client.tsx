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
import { Plus, Pencil, Trash2, Link2, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { savePerson, deletePerson } from "@/features/people/actions";
import { PersonScheduleDialog } from "./person-schedule-dialog";
import { PersonAbsenceDialog } from "./person-absence-dialog";
import type { PersonSpecialty } from "@/generated/prisma";
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

interface NaveSummary { id: string; codigo: string; nombre: string }
interface UserSummary { id: string; name: string; email: string; personId: string | null }

interface PersonWithSpecs {
  id: string;
  displayName: string;
  iniciales: string;
  color: string;
  hourlyRate: number;
  overtimeHourlyRate: number;
  isActive: boolean;
  naveIds: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  specialties: PersonSpecialty[];
  canHardDelete: boolean;
  workWindows: WorkWindowRow[];
  absences: AbsenceRow[];
}

type SpecMode = "ninguno" | "responsable" | "apoyo" | "otra";

const SPECIALTY_SECTIONS = [
  { key: "responsable" as const, title: "Responsable" },
  { key: "apoyo" as const, title: "Apoyo / sustituto" },
  { key: "otra" as const, title: "Otras tareas" },
] as const;

type SpecialtySectionKey = (typeof SPECIALTY_SECTIONS)[number]["key"];

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
  naves = [],
  users = [],
}: {
  people: PersonWithSpecs[];
  processDefs: ProcessDefOption[];
  canManage: boolean;
  naves?: NaveSummary[];
  users?: UserSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [iniciales, setIniciales] = useState("");
  const [color, setColor] = useState("#64748b");
  const [hourlyRate, setHourlyRate] = useState("14.75");
  const [overtimeHourlyRate, setOvertimeHourlyRate] = useState("22.13");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [naveIds, setNaveIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string>("none");
  const [specMap, setSpecMap] = useState<Record<string, SpecMode>>(() =>
    emptySpecMap(processDefs),
  );
  const [pendingAdd, setPendingAdd] = useState<Record<SpecialtySectionKey, string>>({
    responsable: "",
    apoyo: "",
    otra: "",
  });

  const [filterNave, setFilterNave] = useState<string>("all");

  const activeCount = useMemo(() => people.filter((p) => p.isActive).length, [people]);
  const displayedPeople = useMemo(
    () => filterNave === "all" ? people : people.filter((p) => p.naveIds.includes(filterNave)),
    [people, filterNave],
  );

  function openCreate() {
    setEditingId(undefined);
    setIniciales("");
    setColor("#64748b");
    setHourlyRate("14.75");
    setOvertimeHourlyRate("22.13");
    setNotes("");
    setIsActive(true);
    setNaveIds([]);
    setUserId("none");
    setSpecMap(emptySpecMap(processDefs));
    setOpen(true);
  }

  function openEdit(p: PersonWithSpecs) {
    setEditingId(p.id);
    setIniciales(p.iniciales);
    setColor(p.color);
    setHourlyRate(String(p.hourlyRate));
    setOvertimeHourlyRate(String(p.overtimeHourlyRate));
    setNotes(p.notes ?? "");
    setIsActive(p.isActive);
    setNaveIds(p.naveIds);
    const linked = users.find((u) => u.personId === p.id);
    setUserId(linked?.id ?? "none");
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
        const rate = Number(hourlyRate);
        const otRate = Number(overtimeHourlyRate);
        if (Number.isNaN(rate) || rate < 0 || Number.isNaN(otRate) || otRate < 0) {
          toast.error("Tarifas horarias inválidas");
          return;
        }
        if (naveIds.length === 0) {
          toast.error("Selecciona al menos una nave");
          return;
        }
        if (!userId || userId === "none") {
          toast.error("Selecciona un usuario");
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
          iniciales,
          color,
          hourlyRate: rate,
          overtimeHourlyRate: otRate,
          notes: notes.trim() || undefined,
          isActive,
          naveIds,
          userId,
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
        `¿Eliminar definitivamente a ${p.displayName} (${p.iniciales})? Esta acción no se puede deshacer.`,
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

      {naves.length > 1 && (
        <div className="flex items-center gap-2 pb-1">
          <span className="text-xs text-muted-foreground shrink-0">Nave:</span>
          <Select value={filterNave} onValueChange={(v) => setFilterNave(v ?? "all")}>
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las naves</SelectItem>
              {naves.map((n) => (
                <SelectItem key={n.id} value={n.id}>{n.codigo} · {n.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayedPeople.map((p) => {
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
                      <CardTitle className="text-base truncate">{p.displayName}</CardTitle>
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
                        personName={p.displayName}
                        workWindows={p.workWindows}
                      />
                      <PersonAbsenceDialog
                        personId={p.id}
                        personName={p.displayName}
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
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {p.naveIds.map((personNaveId) => {
                    const n = naves.find((x) => x.id === personNaveId);
                    return n ? (
                      <Badge key={n.id} variant="secondary" className="text-[10px]">
                        {n.codigo} · {n.nombre}
                      </Badge>
                    ) : null;
                  })}
                  {(() => {
                    const linkedUser = users.find((u) => u.personId === p.id);
                    return linkedUser ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Link2 className="size-2.5" />
                        {linkedUser.email}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px] gap-1">
                        <Link2Off className="size-2.5" />
                        Sin usuario
                      </Badge>
                    );
                  })()}
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
            {naves.length > 0 && (
              <div className="space-y-2">
                <Label>Naves</Label>
                <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                  {naves.map((n) => {
                    const checked = naveIds.includes(n.id);
                    return (
                      <label key={n.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setNaveIds((prev) =>
                              e.target.checked
                                ? [...prev, n.id]
                                : prev.filter((id) => id !== n.id),
                            )
                          }
                        />
                        {n.codigo} · {n.nombre}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {canManage && users.length > 0 && (() => {
              const availableUsers = users.filter((u) => u.personId === null || u.personId === editingId);
              return (
                <div className="space-y-2">
                  <Label>Usuario de acceso <span className="text-destructive">*</span></Label>
                  <Select
                    value={userId}
                    onValueChange={(v) => v && setUserId(v)}
                    disabled={pending}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un usuario…">
                        {userId === "none"
                          ? "Selecciona un usuario…"
                          : (availableUsers.find((u) => u.id === userId)?.email ??
                            "Selecciona un usuario…")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {availableUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}
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
              <div className="grid gap-3 md:grid-cols-3">
                {SPECIALTY_SECTIONS.map((section) => {
                  const current = processDefs.filter(
                    (d) => specMap[d.code] === section.key,
                  );
                  const available = processDefs.filter(
                    (d) => specMap[d.code] === "ninguno",
                  );
                  return (
                  <div key={section.key} className="border rounded-md p-3 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.title}
                    </div>
                    <div className="space-y-1 max-h-[140px] overflow-y-auto pr-1">
                      {current.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">
                          Sin procesos
                        </p>
                      ) : (
                        current.map((d) => (
                          <div
                            key={d.code}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="truncate text-muted-foreground">
                              {d.label}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6 text-[10px]"
                              onClick={() => setModeForProcess(d.code, "ninguno")}
                              disabled={pending}
                            >
                              ×
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="pt-1">
                      <Select
                        value={pendingAdd[section.key]}
                        onValueChange={(code) => {
                          setModeForProcess(code as ProcessCode, section.key);
                          setPendingAdd((prev) => ({
                            ...prev,
                            [section.key]: "",
                          }));
                        }}
                        disabled={pending || available.length === 0}
                      >
                        <SelectTrigger className="h-7 w-full text-[11px]">
                          <SelectValue
                            placeholder={
                              available.length === 0
                                ? "Sin procesos libres"
                                : "Añadir proceso…"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {available.map((d) => (
                            <SelectItem key={d.code} value={d.code}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );})}
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
              disabled={pending || !iniciales.trim()}
            >
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
