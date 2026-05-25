import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { requireDashboardContext } from "@/lib/context";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import { formatHours, formatShortDate } from "@/lib/format";
import type { ProcessCode } from "@/types/process";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import {
  getAbsencesForRange,
  getActiveProjectsWithLoad,
  getNavePersonnel,
  getHolidaysForRange,
  getPlanningForWeek,
  getPlanningWeights,
  getProcessBadgeStylesByCode,
  summarizeAllActiveProjects,
  summarizePlanning,
  summarizeUnassignedProjects,
} from "@/features/planning/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "../_components/page-header";
import { WeekNav } from "../_components/week-nav";
import { RiskBadge } from "@/components/risk-badge";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import Link from "next/link";
import { GenerateButton } from "./generate-button";
import { PlanningWeightsPopover } from "./planning-weights-popover";
import { getPlanningUndoState } from "@/features/planning/actions";

const DAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];

export default async function ResumenPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);

  const [planning, people, projects, holidays, absences, planningWeights, processStyles] =
    await Promise.all([
    getPlanningForWeek({ naveId: ctx.naveId, weekStart }),
    getNavePersonnel(ctx.naveId),
    getActiveProjectsWithLoad(ctx.naveId),
    getHolidaysForRange(days[0], days[4]),
    getAbsencesForRange(days[0], days[4]),
    getPlanningWeights(ctx.naveId),
    getProcessBadgeStylesByCode(),
  ]);

  const summary = summarizePlanning(planning);
  const undoState = await getPlanningUndoState(
    getMondayOf(weekStart).toISOString(),
  );
  const capacity = computeCapacity(
    days,
    people,
    expandHolidayRangesToIsoDays(holidays, days[0], days[days.length - 1] ?? days[0]),
    absences,
  );

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    days[0],
    days[days.length - 1] ?? days[0],
  );

  const allProjects = summarizeAllActiveProjects(projects, planning);
  const unassignedProjects = summarizeUnassignedProjects(projects, planning);

  const unassignedHours = unassignedProjects.reduce(
    (acc, p) => acc + p.remainingWorkHours,
    0,
  );
  const occupation = capacity.totalCapacity > 0
    ? Math.round((summary.totalHours / capacity.totalCapacity) * 100)
    : 0;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Resumen S${week} · ${year}`}
        description={`Semana ${formatWeekRange(weekStart)}`}
        actions={
          <div className="flex items-center gap-2">
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
            />
            {ctx.naveId ? (
              <>
                <PlanningWeightsPopover
                  initialWeights={planningWeights}
                  role={ctx.role}
                />
                <GenerateButton
                  weekStart={getMondayOf(weekStart).toISOString()}
                  planningId={planning?.id ?? null}
                  planningStatus={planning?.status ?? null}
                  canUndo={undoState.canUndo}
                  hasFuturePlannings={undoState.hasFuturePlannings}
                  isPublished={undoState.isPublished}
                  role={ctx.role}
                />
              </>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                    <Button size="sm" disabled>Generar plan</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Selecciona una nave específica para generar el planning
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Capacidad equipo"
          value={`${formatHours(capacity.totalCapacity)}`}
          sub={`${people.length} operarios × 5 días`}
          icon={<Users className="size-4" />}
        />
        <Kpi
          label="Horas asignadas"
          value={`${formatHours(summary.totalHours)}`}
          sub={`${occupation}% ocupación`}
          icon={<TrendingUp className="size-4" />}
          highlight={occupation > 95 ? "warn" : occupation > 0 ? "ok" : "muted"}
        />
        <Kpi
          label="Sin asignar"
          value={String(unassignedProjects.length)}
          sub={`${formatHours(unassignedHours)} pendientes`}
          icon={<AlertTriangle className="size-4" />}
          highlight={unassignedProjects.length > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="Estado planning"
          value={planning?.status === "PUBLISHED" ? "Publicado" : planning ? "Borrador" : "Sin generar"}
          sub={planning?.publishedAt ? formatShortDate(planning.publishedAt) : "Genera para empezar"}
          icon={planning ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-4" />}
          highlight={planning?.status === "PUBLISHED" ? "ok" : "muted"}
        />
      </div>

      <div className="grid grid-cols-5 gap-3">
        {days.map((day, idx) => {
          const dayKey = day.toISOString().slice(0, 10);
          const used = summary.byDay.get(dayKey) ?? 0;
          const cap = capacity.byDay.get(dayKey) ?? 0;
          const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
          const isHoliday = holidayDates.has(dayKey);
          return (
            <Card key={dayKey} className="text-center">
              <CardContent className="py-3">
                <div className="text-[10px] font-bold tracking-widest text-muted-foreground">
                  {DAY_LABELS[idx]} {day.getUTCDate()}/{day.getUTCMonth() + 1}
                </div>
                {isHoliday ? (
                  <div className="text-xs text-muted-foreground mt-2 italic">
                    Festivo
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-black mt-1">{pct}%</div>
                    <div className="h-1.5 rounded-full bg-secondary mt-2 overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          background:
                            pct > 95
                              ? "var(--destructive)"
                              : pct > 80
                                ? "#A16207"
                                : "var(--primary)",
                        }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {formatHours(used)} / {formatHours(cap)}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" />
            Proyectos
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Progreso global, entregas y fin estimado (orientativo según capacidad del equipo).
          </p>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Tabs defaultValue="todos">
            <TabsList className="m-4 mb-0">
              <TabsTrigger value="todos">Todos ({allProjects.length})</TabsTrigger>
              <TabsTrigger value="sin-asignar">
                Sin asignar ({unassignedProjects.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="todos" className="mt-0">
              <ProjectsTable
                rows={allProjects}
                showAssigned
                showExpected
                processStyles={processStyles}
              />
            </TabsContent>
            <TabsContent value="sin-asignar" className="mt-0">
              <ProjectsTable
                rows={unassignedProjects}
                processStyles={processStyles}
                emptyMessage={
                  planning
                    ? "Todos los proyectos con carga pendiente tienen horas en esta semana"
                    : "No hay proyectos con horas pendientes"
                }
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {planning && planning.assignments.length === 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          Borrador generado sin asignaciones. Revisa los proyectos pendientes y vuelve a generar tras añadir tareas.
        </div>
      )}
    </div>
  );
}

interface ProjectTableRow {
  projectId: string;
  name: string;
  code: string;
  deliveryDate: Date | null;
  estimatedHours: number;
  doneHours: number;
  pendingHours: number;
  remainingWorkHours: number;
  assignedThisWeek?: number;
  progressPct: number;
  expectedProgressPct?: number;
  risk: "OK" | "ATENCION" | "RIESGO" | "SIN_FECHA";
  daysLeft: number | null;
  expectedCompletion?: Date | null;
  pendingProcesses: ProcessCode[];
}

function ProjectsTable({
  rows,
  showAssigned,
  showExpected,
  processStyles,
  emptyMessage = "No hay proyectos",
}: {
  rows: ProjectTableRow[];
  showAssigned?: boolean;
  showExpected?: boolean;
  processStyles: Map<string, ProcessBadgeStyle>;
  emptyMessage?: string;
}) {
  const colSpan =
    9 + (showAssigned ? 1 : 0) + (showExpected ? 1 : 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Proyecto</TableHead>
          <TableHead>Avance</TableHead>
          <TableHead>Riesgo</TableHead>
          <TableHead>Entrega</TableHead>
          <TableHead>Días</TableHead>
          {showExpected ? <TableHead>Fin est.</TableHead> : null}
          {showAssigned ? (
            <TableHead className="text-right">Asign. sem.</TableHead>
          ) : null}
          <TableHead className="text-right">Estimado</TableHead>
          <TableHead className="text-right">Hecho</TableHead>
          <TableHead className="text-right">Pendiente</TableHead>
          <TableHead>Procesos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
                  <TableRow key={row.projectId}>
                    <TableCell>
                      <Link
                        href={`/dashboard/proyectos/${row.projectId}`}
                        className="font-semibold text-sm hover:underline"
                      >
                        {row.name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {row.code}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 min-w-[88px]">
                          <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, row.progressPct)}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono tabular-nums w-8 text-right">
                            {row.progressPct}%
                          </span>
                        </div>
                        {row.expectedProgressPct != null &&
                          row.expectedProgressPct > row.progressPct ? (
                          <div className="text-[10px] text-emerald-600 font-mono">
                            → {row.expectedProgressPct}% est.
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={row.risk} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatShortDate(row.deliveryDate)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.daysLeft != null && row.daysLeft <= 7
                            ? "text-destructive font-bold"
                            : "text-muted-foreground"
                        }
                      >
                        {row.daysLeft != null ? `${row.daysLeft}d` : "—"}
                      </span>
                    </TableCell>
                    {showExpected ? (
                      <TableCell className="font-mono text-xs">
                        {row.expectedCompletion
                          ? formatShortDate(row.expectedCompletion)
                          : "—"}
                      </TableCell>
                    ) : null}
                    {showAssigned ? (
                      <TableCell className="text-right font-mono text-xs">
                        {formatHours(row.assignedThisWeek ?? 0)}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(row.estimatedHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-emerald-700">
                      {formatHours(row.doneHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(row.remainingWorkHours)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {row.pendingProcesses.slice(0, 5).map((p) => (
                          <ProcessBadge
                            key={p}
                            code={p}
                            definition={processStyles.get(p)}
                          />
                        ))}
                        {row.pendingProcesses.length > 5 ? (
                          <Badge variant="secondary" className="text-[10px]">
                            +{row.pendingProcesses.length - 5}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

interface KpiProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  highlight?: "ok" | "warn" | "muted";
}

function Kpi({ label, value, sub, icon, highlight }: KpiProps) {
  const valueColor =
    highlight === "ok"
      ? "text-emerald-600"
      : highlight === "warn"
        ? "text-red-600"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            {label}
          </div>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className={`text-3xl font-black mt-1 ${valueColor}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}

function computeCapacity(
  days: Date[],
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  holidayDates: Set<string>,
  absences: Awaited<ReturnType<typeof getAbsencesForRange>>,
): { totalCapacity: number; byDay: Map<string, number> } {
  const byDay = new Map<string, number>();
  let total = 0;
  for (const day of days) {
    const key = day.toISOString().slice(0, 10);
    const isHoliday = holidayDates.has(key);
    let cap = 0;
    if (!isHoliday) {
      for (const person of people) {
        const absence = absences.find(
          (a) =>
            a.personId === person.id &&
            a.date.toISOString().slice(0, 10) === key,
        );
        cap += Math.max(0, person.capacityHours - (absence?.hours ?? 0));
      }
    }
    byDay.set(key, cap);
    total += cap;
  }
  return { totalCapacity: total, byDay };
}
