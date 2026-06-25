import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { formatHours, formatShortDate } from "@/lib/format";
import { parseOrderExecutionMeta } from "@/features/production-orders/execution";
import {
  getSeqPhaseAtStep,
  parseOrderRouteMeta,
} from "@/features/production-orders/route-meta";
import {
  canExecuteProductionOrders,
  canManageProductionOrders,
} from "@/features/production-orders/permissions";
import { PrintTrigger } from "./print-trigger";
import { OrderExecutionPanel } from "./order-execution-panel";
import { ReworkOrderButton } from "./rework-order-button";

export default async function OrdenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireDashboardContext();
  const canManage = canManageProductionOrders(ctx.role);
  const canExecute = canExecuteProductionOrders(ctx.role);
  const order = await prisma.productionOrder.findFirst({
    where: { id },
    include: {
      project: true,
      nave: { select: { codigo: true, nombre: true } },
      elementType: { select: { name: true } },
      lines: {
        include: { project: true, task: { select: { id: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) notFound();

  const { userNotes, meta } = parseOrderExecutionMeta(order.notes);
  const { route } = parseOrderRouteMeta(order.notes);
  const seqPhase = getSeqPhaseAtStep(route, order.step);

  const projectLabel =
    order.project?.name ??
    (order.lines
      .map((l) => l.project?.name ?? l.clientLabel)
      .filter(Boolean)
      .join(", ") || "—");
  const clientLabel =
    order.project?.client ??
    order.project?.obra ??
    order.lines.find((l) => l.clientLabel)?.clientLabel ??
    "—";
  return (
    <div className="min-h-screen bg-secondary/30 p-6 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/dashboard/ordenes" />}
          >
            <ArrowLeft className="size-4 mr-1" /> Volver
          </Button>
          <div className="flex items-center gap-2">
            {canManage ? (
              <ReworkOrderButton
                orderId={order.id}
                status={order.status}
                kind={order.kind}
                canManage={canManage}
                defaultHours={order.hours}
                defaultProcess={order.process}
              />
            ) : null}
            <PrintTrigger />
          </div>
        </div>
        {canExecute ? (
          <OrderExecutionPanel
            orderId={order.id}
            status={order.status}
            step={order.step}
            plannedHours={order.hours}
            actualHours={meta.actualHours}
            canManage={canManage}
            canExecute={canExecute}
            naveKey={order.naveKey}
            seqPhaseCodigo={seqPhase?.naveCodigo ?? null}
            lines={order.lines.map((l) => ({
              id: l.id,
              units: l.units,
              completedUnits: l.completedUnits,
              projectName: l.project?.name ?? l.clientLabel ?? "—",
            }))}
          />
        ) : null}
        <div className="bg-white border rounded-lg p-10 print:border-0 print:rounded-none print:shadow-none">
          <header className="flex items-start justify-between border-b pb-5 mb-6">
            <div>
              <div className="text-3xl font-black tracking-tight">CONTRACT+</div>
              <div className="text-[10px] font-bold tracking-[0.3em] uppercase text-primary mt-1">
                Coverdec Innovación SL
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Coverdec Innovación SL
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
                Orden de Producción
              </div>
              <div className="font-mono text-2xl font-black mt-1">{order.number}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatShortDate(order.createdAt)}
              </div>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Proyecto
              </div>
              <div className="text-base font-bold">{projectLabel}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Cliente / Obra
              </div>
              <div className="text-base">{clientLabel}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Lámpara
              </div>
              <div>{order.lampLabel ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Proceso
              </div>
              <div>{order.process ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Horas estimadas
              </div>
              <div className="font-mono">{formatHours(order.hours)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Programada
              </div>
              <div className="font-mono">{formatShortDate(order.scheduledAt)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Semana planning
              </div>
              <div className="font-mono text-sm">
                {order.scheduledWeek
                  ? formatShortDate(order.scheduledWeek)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Nave
              </div>
              <div className="text-sm">
                {order.nave ? `${order.nave.codigo} · ${order.nave.nombre}` : "—"}
                {order.naveKey === "SEQ" ? (
                  <span className="ml-2 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold">
                    SEQ
                    {seqPhase ? ` · fase ${seqPhase.naveCodigo}` : null}
                  </span>
                ) : order.naveKey ? (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    ({order.naveKey})
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Tipo
              </div>
              <div className="font-mono text-sm">{order.kind}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Estado
              </div>
              <div className="font-mono text-sm">{order.status}</div>
            </div>
          </section>

          {order.planningGroupId ? (
            <section className="mb-6 text-xs text-muted-foreground">
              Planning coordinado:{" "}
              <span className="font-mono">{order.planningGroupId.slice(0, 12)}…</span>
            </section>
          ) : null}

          {order.lines.length > 0 && (
            <section className="mb-6">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                Destinos
              </div>
              <ul className="text-sm space-y-1">
                {order.lines.map((line) => (
                  <li key={line.id} className="flex justify-between gap-4">
                    <span>
                      {line.project?.name ?? line.clientLabel ?? "—"}
                      {line.ral ? ` · RAL ${line.ral}` : ""}
                      {line.taskId ? (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          (tarea {line.taskId.slice(0, 8)}…)
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-muted-foreground">{line.units} ud</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {userNotes ? (
            <section className="mb-6 border-l-4 border-primary pl-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
                Notas
              </div>
              <p className="text-sm whitespace-pre-wrap">{userNotes}</p>
            </section>
          ) : null}

          <section className="grid grid-cols-3 gap-4 pt-6 border-t">
            <SignatureBox label="Operario" />
            <SignatureBox label="Control calidad" />
            <SignatureBox label="Jefe producción" />
          </section>

          <footer className="text-[9px] text-muted-foreground mt-10 text-center">
            Coverdec Innovación SL · CIF B12345678
          </footer>
        </div>
      </div>
    </div>
  );
}

function SignatureBox({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
        {label}
      </div>
      <div className="h-16 border rounded" />
      <div className="text-[10px] text-muted-foreground">Firma / Fecha</div>
    </div>
  );
}

