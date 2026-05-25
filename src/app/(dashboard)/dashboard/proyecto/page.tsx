import { requireDashboardContext } from "@/lib/context";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
} from "@/lib/week";
import {
  getActiveProjectsWithLoad,
  getActualHoursForWeek,
  getPlanningForWeek,
  getProcessDefinitionsByCode,
  type ActualHourEntry,
} from "@/features/planning/queries";
import {
  buildPlanningTimeline,
  type PlanningAssignmentSlice,
} from "@/features/planning/planning-timeline";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProcessBadge } from "@/components/process-badge";
import { DryWaitBadge } from "@/components/dry-wait-badge";
import { PersonAvatar } from "@/components/person-avatar";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromPlannedEnd,
} from "@/lib/format";
import { rangeLabel } from "@/features/planning/engine/slot-format";

function formatTimeRange(startedAt: Date, hours: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startH = startedAt.getUTCHours();
  const startM = startedAt.getUTCMinutes();
  const totalMins = startH * 60 + startM + Math.round(hours * 60);
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${pad(startH)}:${pad(startM)}–${pad(endH)}:${pad(endM)}`;
}

export default async function ProyectoPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);

  const [projects, processByCode] = await Promise.all([
    getActiveProjectsWithLoad(ctx.naveId),
    getProcessDefinitionsByCode(),
  ]);

  // Fetch the selected view data
  let assignments: PlanningAssignmentSlice[] = [];
  let actualEntries: ActualHourEntry[] = [];

  if (view === "actual") {
    actualEntries = await getActualHoursForWeek({ naveId: ctx.naveId, weekStart });
  } else {
    const planning = await getPlanningForWeek({ naveId: ctx.naveId, weekStart });
    assignments = (planning?.assignments ?? []) as PlanningAssignmentSlice[];
  }

  // Build per-project data
  const byProject = new Map<string, PlanningAssignmentSlice[]>();
  const plannedEndByProject = new Map<string, Date>();
  for (const a of assignments) {
    const list = byProject.get(a.task.projectId) ?? [];
    list.push(a);
    byProject.set(a.task.projectId, list);
    const cur = plannedEndByProject.get(a.task.projectId);
    if (!cur || a.date > cur) plannedEndByProject.set(a.task.projectId, a.date);
  }

  const actualByProject = new Map<string, ActualHourEntry[]>();
  for (const e of actualEntries) {
    if (!e.project) continue;
    const list = actualByProject.get(e.project.id) ?? [];
    list.push(e);
    actualByProject.set(e.project.id, list);
  }

  const projectIdsWithData = new Set([
    ...byProject.keys(),
    ...actualByProject.keys(),
  ]);

  const projectsWithLoad = projects
    .map((p) => ({
      project: p,
      risk: riskFromPlannedEnd(p.deliveryDate, plannedEndByProject.get(p.id) ?? null),
      pending: p.tasks.reduce((acc, t) => acc + Math.max(0, t.estimatedHours - t.doneHours), 0),
      scheduledHours: (byProject.get(p.id) ?? []).reduce((acc, a) => acc + a.hours, 0),
      actualHours: (actualByProject.get(p.id) ?? []).reduce((acc, e) => acc + e.hours, 0),
    }))
    .filter((row) => row.pending > 0 || projectIdsWithData.has(row.project.id))
    .sort((a, b) => {
      const aDate = a.project.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDate = b.project.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por proyecto · S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle basePath="/dashboard/proyecto" view={view} week={weekIso} />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
          </div>
        }
      />

      {projectsWithLoad.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {view === "actual"
            ? "No hay registros de horas para esta semana."
            : "No hay proyectos con trabajo pendiente ni asignaciones esta semana."}
        </p>
      )}

      <div className="space-y-4">
        {projectsWithLoad.map((row) => {
          const workHours = view === "actual" ? row.actualHours : row.scheduledHours;
          const hoursLabel = view === "actual" ? "Registrado S" : "Asignado S";

          return (
            <Card key={row.project.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{row.project.name}</CardTitle>
                  <RiskBadge level={row.risk} />
                </div>
                <div className="text-xs text-muted-foreground flex gap-4">
                  <span>
                    Entrega:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {formatShortDate(row.project.deliveryDate)}
                    </span>
                  </span>
                  <span>
                    Días:{" "}
                    <span className="font-semibold text-foreground">
                      {daysUntil(row.project.deliveryDate) ?? "—"}
                    </span>
                  </span>
                  <span>
                    Pendiente:{" "}
                    <span className="font-semibold text-foreground">
                      {formatHours(row.pending)}
                    </span>
                  </span>
                  <span>
                    {hoursLabel}{week}:{" "}
                    <span className="font-semibold text-foreground">
                      {formatHours(workHours)}
                    </span>
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {view === "actual" ? (
                  <ActualProjectTable
                    entries={actualByProject.get(row.project.id) ?? []}
                    processByCode={processByCode}
                  />
                ) : (
                  <PlanProjectTable
                    timeline={buildPlanningTimeline(
                      byProject.get(row.project.id) ?? [],
                      processByCode,
                    )}
                    processByCode={processByCode}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ActualProjectTable({
  entries,
  processByCode,
}: {
  entries: ActualHourEntry[];
  processByCode: Awaited<ReturnType<typeof getProcessDefinitionsByCode>>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead>Horario</TableHead>
          <TableHead>Operario</TableHead>
          <TableHead>Lámpara</TableHead>
          <TableHead>Proceso</TableHead>
          <TableHead className="text-right">h</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
              Sin registros esta semana
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
                {e.person ? (
                  <div className="flex items-center gap-2">
                    <PersonAvatar
                      iniciales={e.person.iniciales}
                      color={e.person.color}
                      size={20}
                    />
                    <span className="text-xs">{e.person.nombre}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs">{e.lamp?.name ?? "—"}</TableCell>
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
  );
}

function PlanProjectTable({
  timeline,
  processByCode,
}: {
  timeline: ReturnType<typeof buildPlanningTimeline>;
  processByCode: Awaited<ReturnType<typeof getProcessDefinitionsByCode>>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead>Horario</TableHead>
          <TableHead>Operario</TableHead>
          <TableHead>Lámpara</TableHead>
          <TableHead>Proceso</TableHead>
          <TableHead className="text-right">h</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {timeline.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
              Sin asignaciones esta semana
            </TableCell>
          </TableRow>
        ) : (
          timeline.map((item) =>
            item.kind === "dry-wait" ? (
              <TableRow key={item.id} className="bg-amber-50/50">
                <TableCell className="font-mono text-xs">{formatShortDate(item.date)}</TableCell>
                <TableCell className="font-mono text-xs text-amber-900">{item.scheduleLabel}</TableCell>
                <TableCell className="text-xs text-muted-foreground">—</TableCell>
                <TableCell className="text-xs">{item.lampName ?? "—"}</TableCell>
                <TableCell>
                  <DryWaitBadge
                    afterProcess={item.afterProcess}
                    waitHours={item.waitHours}
                    processDefinition={processByCode.get(item.afterProcess)?.badge}
                  />
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
              </TableRow>
            ) : (
              <TableRow key={item.assignment.id}>
                <TableCell className="font-mono text-xs">{formatShortDate(item.assignment.date)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {rangeLabel(item.assignment.startSlot, item.assignment.endSlot)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <PersonAvatar
                      iniciales={item.assignment.person.iniciales}
                      color={item.assignment.person.color}
                      size={20}
                    />
                    <span className="text-xs">
                      {item.assignment.person.alias ?? item.assignment.person.nombre}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{item.assignment.task.lamp?.name ?? "—"}</TableCell>
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
            ),
          )
        )}
      </TableBody>
    </Table>
  );
}
