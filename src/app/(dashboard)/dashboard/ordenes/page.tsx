import Link from "next/link";
import { Printer } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { CreateOrderDialog } from "./create-order-dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHours, formatShortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ProcessBadge } from "@/components/process-badge";

export default async function OrdenesPage() {
  const ctx = await requireDashboardContext();
  const [orders, projects] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { empresaId: ctx.empresaId },
      include: { project: true },
      orderBy: [{ year: "desc" }, { serial: "desc" }],
      take: 200,
    }),
    prisma.project.findMany({
      where: { empresaId: ctx.empresaId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Órdenes de producción"
        description={`${orders.length} órdenes registradas`}
        actions={<CreateOrderDialog projects={projects} />}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OP</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Lámpara</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead>Horas</TableHead>
                <TableHead>Programada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No hay órdenes. Crea la primera.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono font-bold">{o.number}</TableCell>
                    <TableCell>{o.project.name}</TableCell>
                    <TableCell>{o.lampLabel ?? "—"}</TableCell>
                    <TableCell>{o.process ? <ProcessBadge code={o.process} /> : "—"}</TableCell>
                    <TableCell className="font-mono">{formatHours(o.hours)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatShortDate(o.scheduledAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/dashboard/ordenes/${o.id}`} />}
                      >
                        <Printer className="size-3.5 mr-1" />
                        Imprimir
                      </Button>
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
