import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import {
  getAbsencesForRange,
  getActualHoursForWeek,
  getNavePersonnel,
  getPlanningForWeek,
  getProcessDefinitionsByCode,
  type ActualHourEntry,
} from "@/features/planning/queries";
import {
  buildPlanningTimeline,
  filterTimelineForPerson,
  type PlanningAssignmentSlice,
} from "@/features/planning/planning-timeline";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { PersonAvatar } from "@/components/person-avatar";
import { ProcessBadge } from "@/components/process-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { formatHours, formatShortDate } from "@/lib/format";
import { PrintToolbar } from "./print-toolbar";

function formatTimeRange(startedAt: Date, hours: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startH = startedAt.getUTCHours();
  const startM = startedAt.getUTCMinutes();
  const totalMins = startH * 60 + startM + Math.round(hours * 60);
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${pad(startH)}:${pad(startM)}–${pad(endH)}:${pad(endM)}`;
}

export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);

  const [allPeople, absences, processByCode] = await Promise.all([
    getNavePersonnel(ctx.naveId),
    getAbsencesForRange(days[0], days[4]),
    getProcessDefinitionsByCode(),
  ]);

  const people =
    ctx.role === Role.OPERARIO && ctx.personId
      ? allPeople.filter((p) => p.id === ctx.personId)
      : allPeople;

  // Fetch data for the selected view
  let planningAssignments: PlanningAssignmentSlice[] = [];
  let actualEntries: ActualHourEntry[] = [];

  if (view === "actual") {
    const raw = await getActualHoursForWeek({ naveId: ctx.naveId, weekStart });
    actualEntries =
      ctx.role === Role.OPERARIO && ctx.personId
        ? raw.filter((e) => e.personId === ctx.personId)
        : raw;
  } else {
    const planning = await getPlanningForWeek({ naveId: ctx.naveId, weekStart });
    planningAssignments = (planning?.assignments ?? []) as PlanningAssignmentSlice[];
  }

  const fullTimeline = buildPlanningTimeline(planningAssignments, processByCode);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por persona · S${week} · ${year}`}
        description={
          ctx.role === Role.OPERARIO && ctx.personId
            ? `${formatWeekRange(weekStart)} · Tu semana`
            : `${formatWeekRange(weekStart)} · Equipo completo · imprimir para reparto en nave`
        }
        actions={
          <div className="flex items-center gap-2 no-print">
            <ViewToggle basePath="/dashboard/persona" view={view} week={weekIso} />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
            <PrintToolbar />
          </div>
        }
      />

      {view === "plan" && planningAssignments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay planning para esta semana. Genera un borrador desde Resumen.
        </p>
      )}
      {view === "actual" && actualEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay registros de horas para esta semana.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-4 print:grid-cols-1">
        {people.map((p) => {
          const personAbsences = absences.filter((a) => a.personId === p.id);

          if (view === "actual") {
            const entries = actualEntries.filter((e) => e.personId === p.id);
            const total = entries.reduce((acc, e) => acc + e.hours, 0);
            return (
              <PersonCard
                key={p.id}
                person={p}
                total={total}
                absences={personAbsences}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Día</TableHead>
                      <TableHead>Horario</TableHead>
                      <TableHead>Proyecto</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead className="text-right">h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          Sin registros
                        </TableCell>
                      </TableRow>
                    ) : (
                      entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-xs">
                            {formatShortDate(new Date(e.date + "T00:00:00Z"))}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatTimeRange(e.startedAt, e.hours)}
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-xs">
                              {e.project?.name ?? "—"}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {e.lamp?.name ?? ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            {e.process ? (
                              <ProcessBadge
                                code={e.process}
                                definition={processByCode.get(e.process)?.badge}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold">
                            {formatHours(e.hours)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </PersonCard>
            );
          }

          // Plan view
          const items = filterTimelineForPerson(fullTimeline, p.id).filter(
            (i) => i.kind === "work",
          );
          const total = items.reduce(
            (acc, x) => acc + (x.kind === "work" ? x.assignment.hours : 0),
            0,
          );
          return (
            <PersonCard key={p.id} person={p} total={total} absences={personAbsences}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead>Horario</TableHead>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Proceso</TableHead>
                    <TableHead className="text-right">h</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        Sin asignaciones
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.assignment.id}>
                        <TableCell className="font-mono text-xs">
                          {formatShortDate(item.assignment.date)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {rangeLabel(item.assignment.startSlot, item.assignment.endSlot)}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-xs">
                            {item.assignment.task.project.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {item.assignment.task.lamp?.name ?? ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ProcessBadge
                            code={item.assignment.process}
                            definition={processByCode.get(item.assignment.process)?.badge}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">
                          {formatHours(item.assignment.hours)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </PersonCard>
          );
        })}
      </div>
    </div>
  );
}

function PersonCard({
  person,
  total,
  absences,
  children,
}: {
  person: { id: string; nombre: string; iniciales: string; color: string; notes?: string | null };
  total: number;
  absences: { date: Date }[];
  children: React.ReactNode;
}) {
  return (
    <Card className="break-inside-avoid print:border print:shadow-none">
      <CardHeader
        className="flex flex-row items-center gap-3 py-3"
        style={{
          background: person.color,
          color: "white",
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        }}
      >
        <PersonAvatar
          iniciales={person.iniciales}
          color={person.color}
          size={32}
          className="ring-2 ring-white/70"
        />
        <div className="flex-1">
          <CardTitle className="text-white text-base">{person.nombre}</CardTitle>
          <div className="text-[11px] text-white/80">{person.notes ?? ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-white/70">Semana</div>
          <div className="font-bold text-white">{formatHours(total)}</div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {absences.length > 0 && (
          <div className="px-3 py-2 text-xs bg-muted border-b">
            Ausencias:{" "}
            {absences.map((a) => formatShortDate(a.date)).join(", ")}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
