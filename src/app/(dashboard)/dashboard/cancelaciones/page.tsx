import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { loadCancelCandidates } from "@/features/stock/queries";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProcessBadge } from "@/components/process-badge";
import { CancelOrderLineDialog } from "./cancel-order-line-dialog";

export default async function CancelacionesPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  const rows = await loadCancelCandidates();

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Cancelaciones"
        description="Anular unidades de proyectos en OPs activas"
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OP</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Unidades</TableHead>
                <TableHead>RAL</TableHead>
                <TableHead>Paso</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No hay líneas de proyecto pendientes de cancelar.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.lineId}>
                    <TableCell className="font-mono font-bold">{row.orderNumber}</TableCell>
                    <TableCell>{row.projectName}</TableCell>
                    <TableCell className="font-mono">{row.units}</TableCell>
                    <TableCell className="font-mono text-xs">{row.ral ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.step}</TableCell>
                    <TableCell>
                      {row.process ? <ProcessBadge code={row.process} /> : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <CancelOrderLineDialog row={row} />
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
