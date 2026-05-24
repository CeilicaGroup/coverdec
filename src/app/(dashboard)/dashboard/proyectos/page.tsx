import Link from "next/link";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectRowActions } from "./project-row-actions";
import { Card, CardContent } from "@/components/ui/card";
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
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";
import { RiskBadge } from "@/components/risk-badge";
import { Badge } from "@/components/ui/badge";
import { Role } from "@/generated/prisma";

export default async function ProyectosPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const projects = await prisma.project.findMany({
    include: {
      _count: { select: { lamps: true, tasks: true } },
      tasks: { select: { pendingHours: true, doneHours: true, estimatedHours: true } },
    },
    orderBy: [{ isActive: "desc" }, { deliveryDate: { sort: "asc", nulls: "last" } }],
  });

  const projectIds = projects.map((p) => p.id);
  const blocksProject = new Set<string>();
  if (projectIds.length > 0) {
    const [teRows, poRows] = await Promise.all([
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
    ]);
    for (const r of teRows) {
      if (r.projectId) blocksProject.add(r.projectId);
    }
    for (const r of poRows) {
      blocksProject.add(r.projectId);
    }
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Proyectos"
        description={`${projects.length} proyectos`}
        actions={<CreateProjectDialog />}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Cliente / Obra</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Lámparas</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead>Facturable</TableHead>
                {canManage ? <TableHead className="w-[112px] text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const pending = p.tasks.reduce((acc, t) => acc + t.pendingHours, 0);
                const estimated = p.tasks.reduce((acc, t) => acc + t.estimatedHours, 0);
                const done = p.tasks.reduce((acc, t) => acc + t.doneHours, 0);
                const pct = estimated > 0 ? Math.round((done / estimated) * 100) : 0;
                const canHardDelete = !blocksProject.has(p.id);
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
                    <TableCell className="text-xs">
                      {p.client ?? p.obra ?? "—"}
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={riskFromDelivery(p.deliveryDate)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatShortDate(p.deliveryDate)}
                      {p.deliveryDate && (
                        <div className="text-[10px] text-muted-foreground">
                          {daysUntil(p.deliveryDate)}d
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p._count.lamps} L / {p._count.tasks} T
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatHours(pending)}</TableCell>
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
                            notes: p.notes,
                            isActive: p.isActive,
                          }}
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
    </div>
  );
}
