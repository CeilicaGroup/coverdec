import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";
import { AddLampForm } from "./add-lamp-form";
import { LampTasksPanel } from "./lamp-tasks-panel";
import { DeleteLampButton } from "./delete-lamp-button";
import { ProjectDangerZone } from "./project-danger-zone";
import { EditProjectDialog } from "../edit-project-dialog";
import { Role } from "@/generated/prisma";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireDashboardContext();
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, empresaId: ctx.empresaId },
    include: {
      lamps: {
        include: {
          frameType: true,
          tasks: { orderBy: { order: "asc" } },
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!project) notFound();

  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const [timeEntries, orders] = await Promise.all([
    prisma.timeEntry.count({ where: { projectId: id } }),
    prisma.productionOrder.count({ where: { projectId: id } }),
  ]);
  const canHardDelete = timeEntries === 0 && orders === 0;

  const [frameTypes, processDefs] = await Promise.all([
    prisma.frameType.findMany({
      where: { isActive: true },
      include: {
        processes: {
          include: { definition: true },
          orderBy: { sequence: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.processDefinition.findMany({
      select: { code: true, waitHours: true },
    }),
  ]);

  const waitHoursByProcess = Object.fromEntries(
    processDefs.map((p) => [p.code, p.waitHours]),
  ) as Record<string, number>;

  const allTasks = project.lamps.flatMap((l) => l.tasks);
  const totalEstimated = allTasks.reduce((a, t) => a + t.estimatedHours, 0);
  const totalDone = allTasks.reduce((a, t) => a + t.doneHours, 0);
  const totalPending = allTasks.reduce((a, t) => a + t.pendingHours, 0);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={project.name}
        description={`${project.code} · ${project.client ?? project.obra ?? "Sin cliente"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {canManage ? (
              <>
                <EditProjectDialog
                  variant="button"
                  project={{
                    id: project.id,
                    name: project.name,
                    client: project.client,
                    obra: project.obra,
                    deliveryDate: project.deliveryDate,
                    priority: project.priority,
                    isBillable: project.isBillable,
                    notes: project.notes,
                  }}
                />
                <ProjectDangerZone
                  projectId={project.id}
                  projectName={project.name}
                  isActive={project.isActive}
                  canHardDelete={canHardDelete}
                />
              </>
            ) : null}
            <Button variant="outline" render={<Link href="/dashboard/proyectos" />}>
              <ArrowLeft className="size-4 mr-1" />
              Volver
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Entrega" value={formatShortDate(project.deliveryDate)} sub={`${daysUntil(project.deliveryDate) ?? "—"} días`} />
        <Kpi label="Estimado" value={formatHours(totalEstimated)} sub={`${allTasks.length} tareas`} />
        <Kpi label="Hecho" value={formatHours(totalDone)} sub={`${totalEstimated > 0 ? Math.round((totalDone / totalEstimated) * 100) : 0}% avance`} />
        <Kpi label="Pendiente" value={formatHours(totalPending)} sub={<RiskBadge level={riskFromDelivery(project.deliveryDate)} />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lámparas y tareas</CardTitle>
          {canManage ? (
            <AddLampForm
              projectId={project.id}
              frameTypes={frameTypes.map((f) => ({
                id: f.id,
                name: f.name,
                processes: f.processes.map((p) => ({
                  process: p.process,
                  label: p.definition.label,
                  bgColor: p.definition.bgColor,
                  fgColor: p.definition.fgColor,
                  borderColor: p.definition.borderColor,
                })),
              }))}
            />
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {project.lamps.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              Aún sin lámparas. Añade una con bastidor y medida para generar las tareas.
            </p>
          ) : (
            <div className="divide-y">
              {project.lamps.map((l) => {
                const lampPending = l.tasks.reduce((a, t) => a + t.pendingHours, 0);
                return (
                  <div key={l.id}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 bg-card">
                      <div className="font-semibold text-sm min-w-[120px]">{l.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Bastidor: <span className="text-foreground">{l.frameType.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Medida: <span className="font-mono text-foreground">{l.surfaceM2 ?? "—"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Uds: <span className="text-foreground">{l.units}</span>
                      </div>
                      <div className="text-xs font-mono ml-auto">
                        Pendiente: <span className="font-semibold">{formatHours(lampPending)}</span>
                      </div>
                      {canManage ? (
                        <DeleteLampButton lampId={l.id} lampName={l.name} />
                      ) : null}
                    </div>
                    <LampTasksPanel
                      lampId={l.id}
                      tasks={l.tasks}
                      usedProcesses={l.tasks.map((t) => t.process)}
                      waitHoursByProcess={waitHoursByProcess}
                      canManage={canManage}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
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
