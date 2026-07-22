import Link from "next/link";
import type { ReactNode } from "react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectRowActions } from "./project-row-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  daysUntil,
  formatHours,
  formatShortDateTime,
  riskFromDelivery,
} from "@/lib/format";
import { RiskBadge } from "@/components/risk-badge";
import { Badge } from "@/components/ui/badge";
import { Role } from "@/generated/prisma";
import {
  PROJECT_KIND_BADGE_CLASS,
  PROJECT_KIND_LABELS,
} from "@/lib/project-kind";
import {
  buildProjectNavesByProjectId,
  formatProjectNavesColumn,
} from "@/features/projects/task-nave";
import {
  PROJECT_APPROVAL_STATUS_LABELS,
  deriveProjectApprovalStatus,
  isLampEligibleForPlanning,
} from "@/lib/project-approval";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";
import { ProjectNextProcessCell } from "./project-next-process-cell";

interface HoursTotals {
  estimated: number;
  done: number;
  assigned: number;
  pendingToPlan: number;
}

function sumHours(rows: HoursTotals[]): HoursTotals {
  return rows.reduce(
    (acc, row) => ({
      estimated: acc.estimated + row.estimated,
      done: acc.done + row.done,
      assigned: acc.assigned + row.assigned,
      pendingToPlan: acc.pendingToPlan + row.pendingToPlan,
    }),
    { estimated: 0, done: 0, assigned: 0, pendingToPlan: 0 },
  );
}

function buildHoursTotals(
  estimated: number,
  done: number,
  assigned: number,
): HoursTotals {
  return {
    estimated,
    done,
    assigned,
    pendingToPlan: Math.max(0, estimated - done - assigned),
  };
}

function isProjectFinished(tasks: { isCompleted: boolean }[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.isCompleted);
}

function filterTasksForPlanningKpis<
  T extends { lamp: { isApprovedForPlanning: boolean } },
>(tasks: T[]): T[] {
  return tasks.filter((task) =>
    isLampEligibleForPlanning(task.lamp.isApprovedForPlanning),
  );
}

function hoursFromTasks(
  tasks: Array<{ id: string; estimatedHours: number }>,
  doneByTaskId: Map<string, number>,
  assignedByTaskId: Map<string, number>,
): HoursTotals {
  const estimated = tasks.reduce((acc, task) => acc + task.estimatedHours, 0);
  const done = tasks.reduce((acc, task) => acc + (doneByTaskId.get(task.id) ?? 0), 0);
  const assigned = tasks.reduce(
    (acc, task) => acc + (assignedByTaskId.get(task.id) ?? 0),
    0,
  );
  return buildHoursTotals(estimated, done, assigned);
}

export default async function ProyectosPage({
  searchParams,
}: {
  searchParams?: Promise<{ archived?: string; tab?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  const params = (await searchParams) ?? {};
  const showArchived = params.archived === "1";
  const tab = params.tab === "finished" ? "finished" : "active";

  const [projects, responsibleUsers] = await Promise.all([
    prisma.project.findMany({
      where: {
        ...(showArchived ? {} : { isActive: true }),
        kind: { notIn: ["STOCK", "IMPREVISTAS"] },
      },
      include: {
        responsibleUser: { select: { name: true } },
        _count: { select: { lamps: true, tasks: true } },
        lamps: { select: { isApprovedForPlanning: true } },
        tasks: {
          select: {
            id: true,
            estimatedHours: true,
            isCompleted: true,
            order: true,
            process: true,
            processDefinition: { select: { label: true } },
            nave: { select: { id: true, codigo: true, nombre: true } },
            lamp: { select: { isApprovedForPlanning: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: [{ deliveryDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.JEFE_PRODUCCION] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);

  const projectIds = projects.map((p) => p.id);
  const allTaskIds = projects.flatMap((p) => p.tasks.map((t) => t.id));
  const blocksProject = new Set<string>();
  const assignedByTaskId = new Map<string, number>();
  let doneByTaskId = new Map<string, number>();
  const navesByProjectId = new Map<string, { id: string; codigo: string; nombre: string }[]>();
  if (projectIds.length > 0) {
    const [teRows, poRows, doneHours, assignmentGroups, taskNaveRows] = await Promise.all([
      prisma.timeEntry.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      prisma.productionOrder.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      loadDoneHoursByTaskIds(prisma, allTaskIds),
      allTaskIds.length > 0
        ? prisma.planningAssignment.groupBy({
            by: ["taskId"],
            where: { taskId: { in: allTaskIds } },
            _sum: { hours: true },
          })
        : Promise.resolve([]),
      prisma.task.findMany({
        where: { projectId: { in: projectIds } },
        select: {
          projectId: true,
          nave: { select: { id: true, codigo: true, nombre: true } },
        },
        distinct: ["projectId", "naveId"],
      }),
    ]);
    doneByTaskId = doneHours;
    for (const r of teRows) {
      if (r.projectId) blocksProject.add(r.projectId);
    }
    for (const r of poRows) {
      blocksProject.add(r.projectId);
    }
    for (const group of assignmentGroups) {
      assignedByTaskId.set(group.taskId, group._sum.hours ?? 0);
    }
    for (const [projectId, naves] of buildProjectNavesByProjectId(taskNaveRows)) {
      navesByProjectId.set(projectId, naves);
    }
  }

  const projectRows = projects.map((p) => {
    const hours = hoursFromTasks(p.tasks, doneByTaskId, assignedByTaskId);
    const planningTasks = filterTasksForPlanningKpis(p.tasks);
    const planningHours = hoursFromTasks(planningTasks, doneByTaskId, assignedByTaskId);
    const pending = Math.max(0, hours.estimated - hours.done);
    const pct = hours.estimated > 0 ? Math.round((hours.done / hours.estimated) * 100) : 0;
    const pendingProcesses = p.tasks
      .filter((task) => !task.isCompleted)
      .map((task) => task.processDefinition.label);
    const finished = isProjectFinished(p.tasks);
    return {
      project: p,
      hours,
      planningHours,
      pending,
      pct,
      pendingProcesses,
      finished,
      canHardDelete: !blocksProject.has(p.id),
      projectNaves: navesByProjectId.get(p.id),
    };
  });

  const visibleRows = projectRows.filter((row) => {
    if (showArchived) return true;
    if (tab === "finished") return row.finished;
    return !row.finished;
  });

  const globalHours = sumHours(visibleRows.map((row) => row.planningHours));

  const naveHoursById = new Map<
    string,
    { codigo: string; nombre: string; estimated: number; done: number; assigned: number }
  >();
  for (const row of visibleRows) {
    const planningTasks = filterTasksForPlanningKpis(row.project.tasks);
    for (const task of planningTasks) {
      const naveId = task.nave.id;
      const current = naveHoursById.get(naveId) ?? {
        codigo: task.nave.codigo,
        nombre: task.nave.nombre,
        estimated: 0,
        done: 0,
        assigned: 0,
      };
      current.estimated += task.estimatedHours;
      current.done += doneByTaskId.get(task.id) ?? 0;
      current.assigned += assignedByTaskId.get(task.id) ?? 0;
      naveHoursById.set(naveId, current);
    }
  }
  const naveHoursRows = [...naveHoursById.entries()]
    .map(([id, row]) => ({
      id,
      codigo: row.codigo,
      nombre: row.nombre,
      hours: buildHoursTotals(row.estimated, row.done, row.assigned),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Proyectos"
        description={`${visibleRows.length} proyectos · ${formatHours(globalHours.estimated)} estimadas`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!showArchived ? (
              <div className="flex items-center gap-2 text-xs">
                <Link
                  href="/dashboard/proyectos?tab=active"
                  className={tab === "active" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
                >
                  Activos
                </Link>
                <span className="text-muted-foreground">·</span>
                <Link
                  href="/dashboard/proyectos?tab=finished"
                  className={tab === "finished" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
                >
                  Terminados
                </Link>
              </div>
            ) : null}
            <Link
              href={showArchived ? "/dashboard/proyectos" : "/dashboard/proyectos?archived=1"}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {showArchived ? "Ocultar archivados" : "Mostrar archivados"}
            </Link>
            <CreateProjectDialog responsibleOptions={responsibleUsers} />
          </div>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HoursKpi
          label="Estimado"
          value={formatHours(globalHours.estimated)}
          sub={`${visibleRows.length} proyectos visibles · solo planning`}
        />
        <HoursKpi
          label="Asignado"
          value={formatHours(globalHours.assigned)}
          sub="Horas en planning"
        />
        <HoursKpi
          label="Hecho"
          value={formatHours(globalHours.done)}
          sub={
            globalHours.estimated > 0
              ? `${Math.round((globalHours.done / globalHours.estimated) * 100)}% avance`
              : "Sin horas estimadas"
          }
        />
        <HoursKpi
          label="Pend. planificar"
          value={formatHours(globalHours.pendingToPlan)}
          sub="Estimado − hecho − asignado"
        />
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Aprobación</TableHead>
                <TableHead>Próximo proceso</TableHead>
                <TableHead>Cliente / Obra</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Lámparas</TableHead>
                <TableHead>Naves</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead className="text-right">Estimado</TableHead>
                <TableHead className="text-right">Asignado</TableHead>
                <TableHead className="text-right">Hecho</TableHead>
                <TableHead className="text-right" title="Horas aún sin cubrir en planning">
                  Pend. planif.
                </TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead>Facturable</TableHead>
                {canManage ? <TableHead className="w-[112px] text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map(({ project: p, hours, pct, pendingProcesses, finished, canHardDelete, projectNaves }) => {
                const navesLabel = formatProjectNavesColumn(projectNaves);
                return (
                  <TableRow key={p.id} className={p.isActive ? "" : "opacity-50"}>
                    <TableCell>
                      <Link
                        href={`/dashboard/proyectos/${p.id}`}
                        className="font-semibold hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="text-[10px] font-mono text-muted-foreground">{p.code}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={PROJECT_KIND_BADGE_CLASS[p.kind]}
                      >
                        {PROJECT_KIND_LABELS[p.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {
                          PROJECT_APPROVAL_STATUS_LABELS[
                            deriveProjectApprovalStatus(
                              p.lamps.map((lamp) => lamp.isApprovedForPlanning),
                            )
                          ]
                        }
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ProjectNextProcessCell
                        processes={pendingProcesses}
                        finished={finished}
                        hasTasks={p.tasks.length > 0}
                      />
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.client ?? p.obra ?? "—"}
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={riskFromDelivery(p.deliveryDate)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatShortDateTime(p.deliveryDate)}
                      {p.deliveryDate && (
                        <div className="text-[10px] text-muted-foreground">
                          {daysUntil(p.deliveryDate)}d
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p._count.lamps} L / {p._count.tasks} T
                    </TableCell>
                    <TableCell
                      className="text-xs"
                      title={
                        projectNaves?.length
                          ? projectNaves
                              .map((nave) => `${nave.codigo} · ${nave.nombre}`)
                              .join(" · ")
                          : undefined
                      }
                    >
                      {projectNaves && projectNaves.length > 1 ? (
                        <div className="flex flex-wrap gap-1">
                          {projectNaves.map((nave) => (
                            <Badge key={nave.id} variant="secondary" className="font-mono text-[10px]">
                              {nave.codigo}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{navesLabel}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.responsibleUser?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(hours.estimated)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(hours.assigned)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-emerald-700">
                      {formatHours(hours.done)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(hours.pendingToPlan)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{pct}%</TableCell>
                    <TableCell>
                      {p.isBillable ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                          Facturable
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 text-red-700">
                          Interno
                        </Badge>
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right p-1">
                        <ProjectRowActions
                          project={{
                            id: p.id,
                            name: p.name,
                            client: p.client,
                            obra: p.obra,
                            deliveryDate: p.deliveryDate,
                            isBillable: p.isBillable,
                            kind: p.kind,
                            notes: p.notes,
                            responsibleUserId: p.responsibleUserId,
                            isActive: p.isActive,
                          }}
                          responsibleOptions={responsibleUsers}
                          canHardDelete={canHardDelete}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {naveHoursRows.length > 0 ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Carga por nave</CardTitle>
            <p className="text-xs text-muted-foreground">
              Totales de los proyectos visibles, excluyendo pendientes de aprobación y lámparas no aprobadas.
            </p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nave</TableHead>
                  <TableHead className="text-right">Estimado</TableHead>
                  <TableHead className="text-right">Asignado</TableHead>
                  <TableHead className="text-right">Hecho</TableHead>
                  <TableHead className="text-right">Pend. planif.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {naveHoursRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.codigo}
                      <span className="text-muted-foreground font-sans"> · {row.nombre}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(row.hours.estimated)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(row.hours.assigned)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-emerald-700">
                      {formatHours(row.hours.done)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(row.hours.pendingToPlan)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function HoursKpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
          {label}
        </div>
        <div className="text-2xl font-black mt-1">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
