import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { loadStockItems, STATE_LABELS } from "@/features/stock/queries";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHours } from "@/lib/format";

export default async function AlmacenPage() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  const items = await loadStockItems();

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Almacén"
        description="Semielaborados y stock con color disponibles para asignación"
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lámpara / elemento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>RAL</TableHead>
                <TableHead>Unidades</TableHead>
                <TableHead>Min/ud acum.</TableHead>
                <TableHead>OP origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No hay existencias en almacén.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.lampLabel}</TableCell>
                    <TableCell className="text-xs">{STATE_LABELS[item.state]}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.ral ? (
                        <span className="inline-flex items-center gap-1">
                          {item.colorHex ? (
                            <span
                              className="size-3 rounded border"
                              style={{ backgroundColor: item.colorHex }}
                            />
                          ) : null}
                          {item.ral}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono">{item.units}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatHours(item.accumulatedMinPerUnit / 60)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.sourceOrderNumber ?? "—"}
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
