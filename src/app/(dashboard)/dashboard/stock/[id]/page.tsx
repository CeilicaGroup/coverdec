import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatHours, formatShortDate } from "@/lib/format";
import { Role, LampElementStockStatus } from "@/generated/prisma";
import { getStockPoolProjectId } from "@/features/stock/stock-pool";
import {
  buildCatalogNaveByProcess,
} from "@/features/projects/task-nave";
import { LampTasksPanel } from "../../proyectos/[id]/lamp-tasks-panel";
import { EditLampElementsDialog } from "../../proyectos/[id]/edit-lamp-elements-dialog";
import { RenameLampButton } from "../../proyectos/[id]/rename-lamp-button";
import {
  fallbackLampConfig,
  lampElementsToConfig,
} from "@/features/projects/sync-lamp-elements";
import { loadTypologyImageAvailability } from "@/features/catalog/typology-images";
import { loadElementTypeImageAvailability } from "@/features/catalog/element-type-images";
import { LampElementsSummary } from "@/components/typology-symbol";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";
import { isStockLampAssignable } from "@/features/stock/stock-assignable";
import { AssignToProjectDialog } from "./assign-to-project-dialog";
import { DeleteStockLampButton } from "../delete-stock-lamp-button";

const STOCK_STATUS_LABELS: Record<LampElementStockStatus, string> = {
  [LampElementStockStatus.IN_PRODUCTION]: "En producción",
  [LampElementStockStatus.AVAILABLE]: "Disponible",
  [LampElementStockStatus.ASSIGNED]: "Asignada",
};

export default async function StockBatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  if (!canManage) notFound();

  const { id } = await params;
  const stockPoolProjectId = await getStockPoolProjectId();

  const lamp = await prisma.lamp.findFirst({
    where: { id, projectId: stockPoolProjectId },
    include: {
      elementType: true,
      previousProject: { select: { name: true, code: true } },
      elements: {
        orderBy: { createdAt: "asc" },
        select: {
          elementTypeId: true,
          surfaceM2: true,
          stockStatus: true,
          stockBatchCode: true,
          elementType: { select: { name: true, typology: true } },
        },
      },
      tasks: {
        orderBy: { order: "asc" },
        include: {
          nave: { select: { id: true, codigo: true, nombre: true } },
          transportFromNave: { select: { id: true, codigo: true, nombre: true } },
          transportToNave: { select: { id: true, codigo: true, nombre: true } },
          workOrder: { select: { number: true, status: true } },
          lampElement: {
            select: {
              id: true,
              label: true,
              surfaceM2: true,
              elementType: { select: { id: true, name: true, typology: true } },
            },
          },
          _count: { select: { assignments: true, timeEntries: true } },
        },
      },
    },
  });
  if (!lamp) notFound();

  const stockStatus =
    lamp.elements.find((element) => element.stockStatus)?.stockStatus ?? null;
  if (stockStatus === LampElementStockStatus.ASSIGNED) notFound();

  const batchCodes = [
    ...new Set(
      lamp.elements
        .map((element) => element.stockBatchCode)
        .filter((code): code is string => Boolean(code)),
    ),
  ];

  const taskIds = lamp.tasks.map((task) => task.id);
  const doneByTaskId = await loadDoneHoursByTaskIds(prisma, taskIds);
  const tasks = lamp.tasks.map((task) => {
    const doneHours = doneByTaskId.get(task.id) ?? 0;
    return {
      ...task,
      doneHours,
      pendingHours: Math.max(0, task.estimatedHours - doneHours),
    };
  });

  const [elementTypes, processDefs, naves, typologyNaves, projects, typologyImages, elementTypeImages] =
    await Promise.all([
    prisma.elementType.findMany({
      where: { isActive: true },
      include: {
        defaultNave: { select: { id: true, codigo: true, nombre: true } },
        processes: {
          include: { definition: true },
          orderBy: { sequence: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.processDefinition.findMany({
      select: {
        code: true,
        waitHours: true,
        label: true,
        bgColor: true,
        fgColor: true,
        borderColor: true,
      },
    }),
    prisma.nave.findMany({
      where: { isActive: true },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
    prisma.elementTypologyNave.findMany({
      select: { typology: true, defaultNaveId: true },
    }),
    prisma.project.findMany({
      where: { isActive: true, kind: { notIn: ["STOCK", "IMPREVISTAS"] } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    loadTypologyImageAvailability(),
    loadElementTypeImageAvailability(),
  ]);

  const typologyDefaultNaveByTypology = Object.fromEntries(
    typologyNaves.map((row) => [row.typology, row.defaultNaveId]),
  ) as Record<string, string | null>;
  const fallbackNaveId = naves[0]?.id ?? null;
  const elementTypeDefaultNaves = Object.fromEntries(
    elementTypes.map((elementType) => [
      elementType.id,
      elementType.defaultNaveId ??
        typologyDefaultNaveByTypology[elementType.typology] ??
        fallbackNaveId,
    ]),
  ) as Record<string, string | null>;
  const elementTypeDefaultNavesMap = new Map(
    Object.entries(elementTypeDefaultNaves).filter(
      (entry): entry is [string, string] => entry[1] != null,
    ),
  );
  const catalogNaveByElementProcess = Object.fromEntries(
    elementTypes.map((elementType) => [
      elementType.id,
      Object.fromEntries(
        buildCatalogNaveByProcess({
          elementTypeId: elementType.id,
          processes: elementType.processes.map((process) => ({
            process: process.process,
            naveId: process.naveId,
          })),
          elementTypeDefaultNaves: elementTypeDefaultNavesMap,
          fallbackNaveId: fallbackNaveId ?? "",
        }),
      ),
    ]),
  ) as Record<string, Record<string, string>>;

  function mapElementTypeProcesses(
    elementType: (typeof elementTypes)[number],
  ) {
    return elementType.processes.map((p) => ({
      process: p.process,
      hoursPerUnit: p.hoursPerUnit,
      fixedHours: p.fixedHours,
      sequence: p.sequence,
      naveId:
        catalogNaveByElementProcess[elementType.id]?.[p.process] ??
        fallbackNaveId ??
        "",
      label: p.definition.label,
      bgColor: p.definition.bgColor,
      fgColor: p.definition.fgColor,
      borderColor: p.definition.borderColor,
    }));
  }

  const editableElements =
    lamp.elements.length > 0
      ? lampElementsToConfig(lamp.elements)
      : lamp.elementTypeId && lamp.elementType
        ? fallbackLampConfig({
            elementTypeId: lamp.elementTypeId,
            surfaceM2: lamp.surfaceM2,
            units: lamp.units,
            elementType: { typology: lamp.elementType.typology },
          })
        : [];

  const elementSummaryItems = editableElements.map((cfg) => ({
    elementTypeId: cfg.elementTypeId,
    typology: cfg.typology,
    name:
      lamp.elements.find((e) => e.elementTypeId === cfg.elementTypeId)
        ?.elementType.name ?? lamp.elementType?.name ?? "Elemento",
    surfaceM2: cfg.surfaceM2,
    units: cfg.units,
  }));
  const elementSummary =
    elementSummaryItems.length > 0 ? (
      <LampElementsSummary
        elements={elementSummaryItems}
        availability={typologyImages}
        elementTypeImages={elementTypeImages}
      />
    ) : (
      (lamp.elementType?.name ?? "—")
    );

  const totalEstimated = tasks.reduce((a, t) => a + t.estimatedHours, 0);
  const totalDone = tasks.reduce((a, t) => a + t.doneHours, 0);
  const totalPending = tasks.reduce((a, t) => a + t.pendingHours, 0);
  const canHardDelete = !lamp.tasks.some((task) => task._count.timeEntries > 0);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={lamp.name}
        description={
          batchCodes.length > 0
            ? `Lote ${batchCodes.join(", ")}`
            : lamp.previousProject
              ? `Reutilizada desde ${lamp.previousProject.name}`
              : "Lote de stock"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isStockLampAssignable(stockStatus) ? (
              <AssignToProjectDialog
                lampId={lamp.id}
                lampName={lamp.name}
                projects={projects}
              />
            ) : null}
            <DeleteStockLampButton
              lampId={lamp.id}
              lampName={lamp.name}
              canHardDelete={canHardDelete}
              redirectToList
            />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/dashboard/stock" />}
            >
              <ArrowLeft className="size-4 mr-1" />
              Volver al stock
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {stockStatus ? (
          <Badge variant="outline">{STOCK_STATUS_LABELS[stockStatus]}</Badge>
        ) : null}
        {lamp.returnedToStockAt ? (
          <span className="text-xs text-muted-foreground">
            Devuelta {formatShortDate(lamp.returnedToStockAt)}
            {lamp.returnedToStockReason ? ` · ${lamp.returnedToStockReason}` : ""}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi label="Estimado" value={formatHours(totalEstimated)} sub={`${tasks.length} tareas`} />
        <Kpi label="Hecho" value={formatHours(totalDone)} sub={`${totalEstimated > 0 ? Math.round((totalDone / totalEstimated) * 100) : 0}% avance`} />
        <Kpi label="Pendiente" value={formatHours(totalPending)} sub="En pool de stock" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración del lote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <RenameLampButton lampId={lamp.id} initialName={lamp.name} canManage={canManage} />
            <div className="text-xs text-muted-foreground min-w-0">
              Elementos:{" "}
              <span className="text-foreground">{elementSummary}</span>
            </div>
            <EditLampElementsDialog
              key={`${lamp.id}-${lamp.updatedAt.toISOString()}`}
              lampId={lamp.id}
              lampName={lamp.name}
              initialElements={editableElements}
              typologyImages={typologyImages}
              elementTypeImages={elementTypeImages}
              elementTypes={elementTypes.map((f) => ({
                id: f.id,
                name: f.name,
                typology: f.typology,
                processes: mapElementTypeProcesses(f),
              }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tareas de producción</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LampTasksPanel
            lampId={lamp.id}
            tasks={tasks}
            usedProcesses={tasks.map((t) => t.process)}
            waitHoursByProcess={Object.fromEntries(
              processDefs.map((p) => [p.code, p.waitHours]),
            )}
            processStylesByCode={Object.fromEntries(
              processDefs.map((p) => [
                p.code,
                {
                  label: p.label,
                  bgColor: p.bgColor,
                  fgColor: p.fgColor,
                  borderColor: p.borderColor,
                },
              ]),
            )}
            canManage={canManage}
            naves={naves}
            elementTypeDefaultNaves={elementTypeDefaultNaves}
            catalogNaveByElementProcess={catalogNaveByElementProcess}
            typologyImages={typologyImages}
            elementTypeImages={elementTypeImages}
          />
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
