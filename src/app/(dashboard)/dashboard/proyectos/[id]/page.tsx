import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProcessBadge } from "@/components/process-badge";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";
import { AddLampForm } from "./add-lamp-form";
import { AddTaskForm } from "./add-task-form";
import { ProjectDangerZone } from "./project-danger-zone";
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
      lamps: { include: { frameType: true, tasks: true } },
      tasks: { include: { lamp: true } },
    },
  });
  if (!project) notFound();

  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const [timeEntries, orders] = await Promise.all([
    prisma.timeEntry.count({ where: { projectId: id } }),
    prisma.productionOrder.count({ where: { projectId: id } }),
  ]);
  const canHardDelete = timeEntries === 0 && orders === 0;

  const frameTypes = await prisma.frameType.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  const totalEstimated = project.tasks.reduce((a, t) => a + t.estimatedHours, 0);
  const totalDone = project.tasks.reduce((a, t) => a + t.doneHours, 0);
  const totalPending = project.tasks.reduce((a, t) => a + t.pendingHours, 0);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={project.name}
        description={`${project.code} · ${project.client ?? project.obra ?? "Sin cliente"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {canManage ? (
              <ProjectDangerZone
                projectId={project.id}
                projectName={project.name}
                isActive={project.isActive}
                canHardDelete={canHardDelete}
              />
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
        <Kpi label="Estimado" value={formatHours(totalEstimated)} sub={`${project.tasks.length} tareas`} />
        <Kpi label="Hecho" value={formatHours(totalDone)} sub={`${totalEstimated > 0 ? Math.round((totalDone / totalEstimated) * 100) : 0}% avance`} />
        <Kpi label="Pendiente" value={formatHours(totalPending)} sub={<RiskBadge level={riskFromDelivery(project.deliveryDate)} />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lámparas</CardTitle>
          <AddLampForm
            projectId={project.id}
            frameTypes={frameTypes.map((f) => ({ id: f.id, name: f.name }))}
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo bastidor</TableHead>
                <TableHead>Medida</TableHead>
                <TableHead>Unidades</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.lamps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    Aún sin lámparas
                  </TableCell>
                </TableRow>
              ) : (
                project.lamps.map((l) => {
                  const lampPending = l.tasks.reduce((a, t) => a + t.pendingHours, 0);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-semibold text-sm">{l.name}</TableCell>
                      <TableCell className="text-xs">{l.frameType?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {l.surfaceM2 ? `${l.surfaceM2}m²` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{l.units}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatHours(lampPending)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tareas</CardTitle>
          <AddTaskForm
            projectId={project.id}
            lamps={project.lamps.map((l) => ({ id: l.id, name: l.name }))}
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lámpara</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead className="text-right">Estimado</TableHead>
                <TableHead className="text-right">Hecho</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    Sin tareas
                  </TableCell>
                </TableRow>
              ) : (
                project.tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{t.lamp?.name ?? "—"}</TableCell>
                    <TableCell>
                      <ProcessBadge code={t.process} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(t.estimatedHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(t.doneHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(t.pendingHours)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
