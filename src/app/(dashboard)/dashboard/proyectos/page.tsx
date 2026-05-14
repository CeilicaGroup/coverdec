import Link from "next/link";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { CreateProjectDialog } from "./create-project-dialog";
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

export default async function ProyectosPage() {
  const ctx = await requireDashboardContext();
  const projects = await prisma.project.findMany({
    where: { empresaId: ctx.empresaId },
    include: {
      _count: { select: { lamps: true, tasks: true } },
      tasks: { select: { pendingHours: true, doneHours: true, estimatedHours: true } },
    },
    orderBy: [{ isActive: "desc" }, { deliveryDate: { sort: "asc", nulls: "last" } }],
  });

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const pending = p.tasks.reduce((acc, t) => acc + t.pendingHours, 0);
                const estimated = p.tasks.reduce((acc, t) => acc + t.estimatedHours, 0);
                const done = p.tasks.reduce((acc, t) => acc + t.doneHours, 0);
                const pct = estimated > 0 ? Math.round((done / estimated) * 100) : 0;
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
