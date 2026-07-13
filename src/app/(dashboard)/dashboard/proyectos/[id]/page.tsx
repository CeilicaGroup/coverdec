import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";
import { AddLampForm } from "./add-lamp-form";
import { EditLampElementsDialog } from "./edit-lamp-elements-dialog";
import {
  buildCatalogNaveByProcess,
} from "@/features/projects/task-nave";
import { LampTasksPanel } from "./lamp-tasks-panel";
import {
  fallbackLampConfig,
  lampElementsToConfig,
} from "@/features/projects/sync-lamp-elements";
import { loadTypologyImageAvailability } from "@/features/catalog/typology-images";
import { LampElementsSummary } from "@/components/typology-symbol";
import { isManualEstimateLamp } from "@/lib/manual-lamp";
import { isManualEstimateProjectKind, isStockProjectKind, PROJECT_KIND_LABELS } from "@/lib/project-kind";
import { PROJECT_APPROVAL_STATUS_LABELS } from "@/lib/project-approval";
import { isStockLampAssignable } from "@/features/stock/stock-assignable";
import { DeleteLampButton } from "./delete-lamp-button";
import { RenameLampButton } from "./rename-lamp-button";
import { ReturnToStockButton } from "./return-to-stock-button";
import { AssignFromStockDialog } from "./assign-from-stock-dialog";
import { ProjectDangerZone } from "./project-danger-zone";
import { ProjectLampSection, ProjectLampsList } from "./project-lamps-list";
import { LampApprovalToggle } from "./lamp-approval-toggle";
import { EditProjectDialog } from "../edit-project-dialog";
import { Role, ProjectApprovalStatus } from "@/generated/prisma";
import { listStockLamps } from "@/features/stock/actions";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireDashboardContext();
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id },
    include: {
      lamps: {
        include: {
          elementType: true,
          elements: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              label: true,
              elementTypeId: true,
              surfaceM2: true,
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
                  elementType: { select: { id: true, name: true } },
                },
              },
              _count: { select: { assignments: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!project) notFound();

  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  const taskIds = project.lamps.flatMap((lamp) => lamp.tasks.map((task) => task.id));
  const doneByTaskId = await loadDoneHoursByTaskIds(prisma, taskIds);
  const lamps = project.lamps.map((lamp) => ({
    ...lamp,
    tasks: lamp.tasks.map((task) => {
      const doneHours = doneByTaskId.get(task.id) ?? 0;
      return {
        ...task,
        doneHours,
        pendingHours: Math.max(0, task.estimatedHours - doneHours),
      };
    }),
  }));

  const [timeEntries, orders] = await Promise.all([
    prisma.timeEntry.count({ where: { projectId: id } }),
    prisma.productionOrder.count({ where: { projectId: id } }),
  ]);
  const canHardDelete = timeEntries === 0 && orders === 0;

  const [elementTypes, processDefs, naves, typologyNaves, responsibleUsers, stockLamps, typologyImages] =
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
    prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.JEFE_PRODUCCION] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    canManage ? listStockLamps() : Promise.resolve([]),
    loadTypologyImageAvailability(),
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

  const waitHoursByProcess = Object.fromEntries(
    processDefs.map((p) => [p.code, p.waitHours]),
  ) as Record<string, number>;

  const processStylesByCode = Object.fromEntries(
    processDefs.map((p) => [
      p.code,
      {
        label: p.label,
        bgColor: p.bgColor,
        fgColor: p.fgColor,
        borderColor: p.borderColor,
      },
    ]),
  );

  const allTasks = lamps.flatMap((l) => l.tasks);
  const totalEstimated = allTasks.reduce((a, t) => a + t.estimatedHours, 0);
  const totalDone = allTasks.reduce((a, t) => a + t.doneHours, 0);
  const assignedHoursRows = await prisma.planningAssignment.aggregate({
    where: { task: { projectId: id } },
    _sum: { hours: true },
  });
  const totalAssigned = assignedHoursRows._sum.hours ?? 0;
  const totalPending = allTasks.reduce(
    (a, t) => a + Math.max(0, t.estimatedHours - t.doneHours),
    0,
  );
  const totalPendingToPlan = Math.max(0, totalEstimated - totalDone - totalAssigned);
  const availableStockLamps = stockLamps
    .filter((lamp) => isStockLampAssignable(lamp.stockStatus))
    .map((lamp) => ({
      id: lamp.id,
      name: lamp.name,
      elementTypeName: lamp.elementTypeName,
      batchCodes: lamp.batchCodes,
      pendingHours: lamp.pendingHours,
      previousProject: lamp.previousProject,
    }));
  const showStockActions = canManage && !isStockProjectKind(project.kind);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={project.name}
        description={`${project.code} · ${PROJECT_KIND_LABELS[project.kind]} · ${PROJECT_APPROVAL_STATUS_LABELS[project.approvalStatus]} · ${project.client ?? project.obra ?? "Sin cliente"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {canManage ? (
              <>
                {showStockActions ? (
                  <AssignFromStockDialog
                    projectId={project.id}
                    stockLamps={availableStockLamps}
                  />
                ) : null}
                <EditProjectDialog
                  variant="button"
                  project={{
                    id: project.id,
                    name: project.name,
                    client: project.client,
                    obra: project.obra,
                    deliveryDate: project.deliveryDate,
                    isBillable: project.isBillable,
                    kind: project.kind,
                    approvalStatus: project.approvalStatus,
                    notes: project.notes,
                    responsibleUserId: project.responsibleUserId,
                  }}
                  responsibleOptions={responsibleUsers}
                />
                <ProjectDangerZone
                  projectId={project.id}
                  projectName={project.name}
                  isActive={project.isActive}
                  canHardDelete={canHardDelete}
                />
              </>
            ) : null}
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/dashboard/proyectos" />}
            >
              <ArrowLeft className="size-4 mr-1" />
              Volver
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Entrega" value={formatShortDate(project.deliveryDate)} sub={`${daysUntil(project.deliveryDate) ?? "—"} días`} />
        <Kpi label="Estimado" value={formatHours(totalEstimated)} sub={`${allTasks.length} tareas`} />
        <Kpi label="Asignado" value={formatHours(totalAssigned)} sub="En planning" />
        <Kpi label="Hecho" value={formatHours(totalDone)} sub={`${totalEstimated > 0 ? Math.round((totalDone / totalEstimated) * 100) : 0}% avance`} />
        <Kpi label="Pend. planificar" value={formatHours(totalPendingToPlan)} sub={<RiskBadge level={riskFromDelivery(project.deliveryDate)} />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lámparas y tareas</CardTitle>
          {canManage ? (
            <AddLampForm
              projectId={project.id}
              projectKind={project.kind}
              typologyImages={typologyImages}
              elementTypes={elementTypes.map((f) => ({
                id: f.id,
                name: f.name,
                typology: f.typology,
                processes: mapElementTypeProcesses(f),
              }))}
            />
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {project.lamps.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              {isManualEstimateProjectKind(project.kind)
                ? "Aún sin lámparas. Puedes crear una por elementos o asignarle un total de horas."
                : "Aún sin lámparas. Añade una con elemento y medida para generar las tareas."}
            </p>
          ) : (
            <ProjectLampsList lampCount={lamps.length}>
              {lamps.map((l) => {
                const manualLamp = isManualEstimateLamp(l);
                const lampPending = l.tasks.reduce((a, t) => a + Math.max(0, t.estimatedHours - t.doneHours), 0);
                const lampEstimated = l.tasks.reduce((a, t) => a + t.estimatedHours, 0);
                const editableElements =
                  !manualLamp && l.elements.length > 0
                    ? lampElementsToConfig(l.elements)
                    : !manualLamp && l.elementTypeId && l.elementType
                      ? fallbackLampConfig({
                          elementTypeId: l.elementTypeId,
                          surfaceM2: l.surfaceM2,
                          units: l.units,
                          elementType: { typology: l.elementType.typology },
                        })
                      : [];
                const elementSummaryItems = editableElements.map((cfg) => ({
                  typology: cfg.typology,
                  name:
                    l.elements.find((e) => e.elementTypeId === cfg.elementTypeId)
                      ?.elementType.name ?? l.elementType?.name ?? "Elemento",
                  surfaceM2: cfg.surfaceM2,
                  units: cfg.units,
                }));
                const elementSummary = manualLamp
                  ? lampEstimated > 0
                    ? `${formatHours(lampEstimated)} estimadas`
                    : "Sin horas asignadas"
                  : elementSummaryItems.length > 0
                    ? (
                        <LampElementsSummary
                          elements={elementSummaryItems}
                          availability={typologyImages}
                        />
                      )
                    : (l.elementType?.name ?? "—");
                return (
                  <ProjectLampSection
                    key={l.id}
                    summary={elementSummary}
                    pendingHours={lampPending}
                    defaultExpanded={lamps.length <= 2}
                    header={
                      <>
                        <RenameLampButton lampId={l.id} initialName={l.name} canManage={canManage} />
                        {project.approvalStatus === ProjectApprovalStatus.PARTIAL_APPROVAL ? (
                          <LampApprovalToggle
                            lampId={l.id}
                            isApproved={l.isApprovedForPlanning}
                            canManage={canManage}
                          />
                        ) : null}
                      </>
                    }
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 bg-muted/10 border-t">
                      <div className="text-xs text-muted-foreground min-w-0">
                        {manualLamp ? "Horas" : "Elementos"}:{" "}
                        <span className="text-foreground">{elementSummary}</span>
                      </div>
                      {canManage && !manualLamp ? (
                        <EditLampElementsDialog
                          key={`${l.id}-${l.updatedAt.toISOString()}`}
                          lampId={l.id}
                          lampName={l.name}
                          initialElements={editableElements}
                          typologyImages={typologyImages}
                          elementTypes={elementTypes.map((f) => ({
                            id: f.id,
                            name: f.name,
                            typology: f.typology,
                            processes: mapElementTypeProcesses(f),
                          }))}
                        />
                      ) : null}
                      {canManage ? (
                        <DeleteLampButton lampId={l.id} lampName={l.name} />
                      ) : null}
                      {showStockActions ? (
                        <ReturnToStockButton
                          lampId={l.id}
                          lampName={l.name}
                          selectableUnits={l.elements.map((element) => ({
                            id: element.id,
                            label:
                              element.label ??
                              element.elementType.name ??
                              l.name,
                            hasPlanning: l.tasks.some(
                              (task) =>
                                task.lampElementId === element.id &&
                                task._count.assignments > 0,
                            ),
                          }))}
                          hasPlanning={l.tasks.some(
                            (task) => task._count.assignments > 0,
                          )}
                        />
                      ) : null}
                    </div>
                    <LampTasksPanel
                      lampId={l.id}
                      tasks={l.tasks}
                      usedProcesses={l.tasks.map((t) => t.process)}
                      waitHoursByProcess={waitHoursByProcess}
                      processStylesByCode={processStylesByCode}
                      canManage={canManage}
                      naves={naves}
                      elementTypeDefaultNaves={elementTypeDefaultNaves}
                      catalogNaveByElementProcess={catalogNaveByElementProcess}
                    />
                  </ProjectLampSection>
                );
              })}
            </ProjectLampsList>
          )}
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
