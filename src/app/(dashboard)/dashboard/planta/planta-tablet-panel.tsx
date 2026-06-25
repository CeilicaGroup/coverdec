"use client";

import { useTransition } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductionOrderStatus } from "@/generated/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import { reportMutationError } from "@/lib/mutation-error";
import {
  resumeProductionOrderAction,
  startProductionOrderAction,
} from "@/features/production-orders/actions";
import { OrderExecutionPanel } from "../ordenes/[id]/order-execution-panel";

export interface OperatorOrderCard {
  id: string;
  number: string;
  status: ProductionOrderStatus;
  process: string | null;
  hours: number | null;
  actualHours: number;
  step: number;
  naveLabel: string | null;
  projectLabel: string;
  totalUnits: number;
  completedUnits: number;
  canManage: boolean;
  canExecute: boolean;
  lines: {
    id: string;
    units: number;
    completedUnits: number;
    projectName: string;
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

export function PlantaTabletPanel({ orders }: { orders: OperatorOrderCard[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const quickAction = (orderId: string, action: "start" | "resume") => {
    startTransition(async () => {
      try {
        if (action === "start") {
          await startProductionOrderAction({ orderId });
          toast.success("OP iniciada");
        } else {
          await resumeProductionOrderAction({ orderId });
          toast.success("OP reanudada");
        }
        router.refresh();
      } catch (err) {
        toast.error(reportMutationError("No se pudo actualizar la OP", err));
      }
    });
  };

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No hay órdenes pendientes para hoy en tu nave.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {orders.map((order) => (
        <Card key={order.id} className="overflow-hidden">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-xl font-black">{order.number}</div>
                <div className="text-sm text-muted-foreground">{order.projectLabel}</div>
              </div>
              {order.process ? <ProcessBadge code={order.process} /> : null}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Estado</div>
                <div>{STATUS_LABELS[order.status]}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Progreso</div>
                <div className="font-mono">
                  {order.completedUnits}/{order.totalUnits} ud
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Plan</div>
                <div className="font-mono">{formatHours(order.hours)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Nave</div>
                <div className="text-xs">{order.naveLabel ?? "—"}</div>
              </div>
            </div>

            {order.status === ProductionOrderStatus.PEND ? (
              <Button
                className="w-full h-12 text-base"
                disabled={pending}
                onClick={() => quickAction(order.id, "start")}
              >
                {pending ? (
                  <Loader2 className="size-5 animate-spin mr-2" />
                ) : (
                  <Play className="size-5 mr-2" />
                )}
                Iniciar
              </Button>
            ) : null}

            {order.status === ProductionOrderStatus.INT ? (
              <Button
                className="w-full h-12 text-base"
                variant="secondary"
                disabled={pending}
                onClick={() => quickAction(order.id, "resume")}
              >
                {pending ? (
                  <Loader2 className="size-5 animate-spin mr-2" />
                ) : (
                  <RotateCcw className="size-5 mr-2" />
                )}
                Reanudar
              </Button>
            ) : null}

            {order.canExecute &&
            (order.status === ProductionOrderStatus.CURSO ||
              order.status === ProductionOrderStatus.MULTI ||
              order.status === ProductionOrderStatus.INT) ? (
              <OrderExecutionPanel
                orderId={order.id}
                status={order.status}
                step={order.step}
                plannedHours={order.hours}
                actualHours={order.actualHours}
                canManage={order.canManage}
                canExecute={order.canExecute}
                lines={order.lines.map((l) => ({
                  id: l.id,
                  units: l.units,
                  completedUnits: l.completedUnits,
                  projectName: l.projectName,
                }))}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
