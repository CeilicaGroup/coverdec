"use client";

import Link from "next/link";
import { ProductionOrderStatus } from "@/generated/prisma";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours, formatShortDate } from "@/lib/format";
import { OrderExecutionPanel } from "./[id]/order-execution-panel";

export interface OrderDetailData {
  id: string;
  number: string;
  status: ProductionOrderStatus;
  process: string | null;
  hours: number | null;
  actualHours: number;
  step: number;
  scheduledAt: string | null;
  scheduledWeek: string | null;
  planningGroupId: string | null;
  naveLabel: string | null;
  userNotes: string;
  totalUnits: number;
  completedUnits: number;
  canManage: boolean;
  canExecute: boolean;
  lines: {
    id: string;
    taskId: string | null;
    projectName: string;
    units: number;
    completedUnits: number;
    ral: string | null;
  }[];
}

const STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  PEND: "Pendiente",
  CURSO: "En curso",
  INT: "Interrumpida",
  MULTI: "Multiday",
  IMPRIMADO: "Imprimado (almacén)",
  CERR: "Cerrada",
};

export function OrderDetailDrawer({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetailData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!order) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">{order.number}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {order.process ? <ProcessBadge code={order.process} /> : null}
            <span>{STATUS_LABELS[order.status]}</span>
            {order.naveLabel ? (
              <span className="text-muted-foreground text-xs">{order.naveLabel}</span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Plan</div>
              <div className="font-mono">{formatHours(order.hours)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Real</div>
              <div className="font-mono">{formatHours(order.actualHours)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Unidades</div>
              <div className="font-mono">
                {order.completedUnits}/{order.totalUnits}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Programada</div>
              <div className="font-mono text-xs">
                {order.scheduledAt
                  ? formatShortDate(new Date(order.scheduledAt))
                  : "—"}
              </div>
            </div>
          </div>

          {order.planningGroupId ? (
            <p className="text-xs text-muted-foreground">
              Planning: {order.scheduledWeek ?? "—"}
            </p>
          ) : null}

          <div>
            <div className="text-xs font-medium mb-1">Destinos</div>
            <ul className="text-sm space-y-1">
              {order.lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-2">
                  <span>
                    {line.projectName}
                    {line.ral ? ` · RAL ${line.ral}` : ""}
                  </span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {line.completedUnits}/{line.units} ud
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {order.userNotes ? (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {order.userNotes}
            </p>
          ) : null}

          {order.canExecute ? (
            <OrderExecutionPanel
              orderId={order.id}
              status={order.status}
              step={order.step}
              plannedHours={order.hours}
              actualHours={order.actualHours}
              canManage={order.canManage}
              lines={order.lines}
            />
          ) : null}

          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/dashboard/ordenes/${order.id}`} />}
          >
            Imprimir OP
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
