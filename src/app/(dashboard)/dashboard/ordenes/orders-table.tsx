"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PanelRightOpen, Printer } from "lucide-react";
import { ProductionOrderStatus } from "@/generated/prisma";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface OrderRow {
  id: string;
  number: string;
  status: ProductionOrderStatus;
  process: string | null;
  hours: number | null;
  actualHours: number;
  deviationPct: number | null;
  totalUnits: number;
  completedUnits: number;
  scheduledAt: string | null;
  scheduledWeek: string | null;
  planningGroupId: string | null;
  naveLabel: string | null;
  projectLabel: string;
  linesSummary: string;
}

export interface OrdersKpis {
  weekTotal: number;
  weekHours: number;
  inProgress: number;
  avgDeviationPct: number | null;
}

const STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  PEND: "Pendiente",
  CURSO: "En curso",
  INT: "Interrumpida",
  MULTI: "Multiday",
  CERR: "Cerrada",
};

const IN_PROGRESS = new Set<ProductionOrderStatus>([
  ProductionOrderStatus.CURSO,
  ProductionOrderStatus.INT,
  ProductionOrderStatus.MULTI,
]);

function DeviationBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground text-xs">—</span>;
  const label = pct > 0 ? `+${pct}%` : `${pct}%`;
  return (
    <span
      className={cn(
        "font-mono text-xs",
        pct > 10 && "text-destructive",
        pct < -10 && "text-emerald-600",
      )}
    >
      {label}
    </span>
  );
}

export function OrdersTable({
  orders,
  kpis,
  processOptions,
  onOpenOrder,
}: {
  orders: OrderRow[];
  kpis: OrdersKpis;
  processOptions: string[];
  onOpenOrder?: (orderId: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [processFilter, setProcessFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (processFilter !== "all" && o.process !== processFilter) return false;
      return true;
    });
  }, [orders, statusFilter, processFilter]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">OPs semana actual</div>
            <div className="text-2xl font-bold font-mono">{kpis.weekTotal}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Horas estimadas (semana)</div>
            <div className="text-2xl font-bold font-mono">{formatHours(kpis.weekHours)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">En curso</div>
            <div className="text-2xl font-bold font-mono">{kpis.inProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Desvío medio plan/real (semana)</div>
            <div className="text-2xl font-bold font-mono">
              {kpis.avgDeviationPct != null ? (
                <DeviationBadge pct={kpis.avgDeviationPct} />
              ) : (
                "—"
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "all")}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {(Object.keys(STATUS_LABELS) as ProductionOrderStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={processFilter}
          onValueChange={(v) => setProcessFilter(v ?? "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Proceso" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los procesos</SelectItem>
            {processOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OP</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Progreso</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead>Nave</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Real</TableHead>
                <TableHead>Desvío</TableHead>
                <TableHead>Programada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                    No hay órdenes con estos filtros.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono font-bold">
                      {onOpenOrder ? (
                        <button
                          type="button"
                          className="hover:underline text-left"
                          onClick={() => onOpenOrder(o.id)}
                        >
                          {o.number}
                        </button>
                      ) : (
                        <Link href={`/dashboard/ordenes/${o.id}`} className="hover:underline">
                          {o.number}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{STATUS_LABELS[o.status]}</TableCell>
                    <TableCell>{o.projectLabel}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.completedUnits}/{o.totalUnits} ud
                    </TableCell>
                    <TableCell>{o.process ? <ProcessBadge code={o.process} /> : "—"}</TableCell>
                    <TableCell className="text-xs">{o.naveLabel ?? "—"}</TableCell>
                    <TableCell className="font-mono">{formatHours(o.hours)}</TableCell>
                    <TableCell className="font-mono">{formatHours(o.actualHours)}</TableCell>
                    <TableCell>
                      <DeviationBadge pct={o.deviationPct} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.scheduledAt ? formatShortDate(new Date(o.scheduledAt)) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {onOpenOrder ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenOrder(o.id)}
                          >
                            <PanelRightOpen className="size-3.5 mr-1" />
                            Detalle
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/dashboard/ordenes/${o.id}`} />}
                        >
                          <Printer className="size-3.5 mr-1" />
                          Imprimir
                        </Button>
                      </div>
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

export { IN_PROGRESS };
