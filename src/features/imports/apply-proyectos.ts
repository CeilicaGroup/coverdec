import { prisma } from "@/lib/db";
import { ProjectApprovalStatus } from "@/generated/prisma";
import { lampNameFields } from "@/features/projects/lamp-name-validation";
import { syncProjectApprovalStatus } from "@/features/projects/sync-project-approval";
import {
  elementTaskScopeWhere,
  loadTaskNaveContext,
  resolveNaveForElementType,
} from "@/features/projects/task-nave";
import { ensureProcessDefinitions } from "./ensure-process-definitions";
import {
  buildLegacyEntityIndex,
  matchElementTypeByBastidorName,
  projectCodeFromName,
} from "./match-legacy-entities";
import { runImportTransaction } from "./transaction";
import type { ProyectoApplySummary, ProyectoRowDraft } from "./types";
import { isTerminatedStatus } from "./types";

async function loadApplyIndex() {
  const [elementTypes, projects, tasks, users] = await Promise.all([
    prisma.elementType.findMany({
      select: { id: true, name: true, code: true },
    }),
    prisma.project.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        lamps: { select: { id: true, name: true, nameKey: true, projectId: true } },
      },
    }),
    prisma.task.findMany({
      select: {
        id: true,
        projectId: true,
        lampId: true,
        process: true,
        lampElementId: true,
        lampElement: {
          select: { elementType: { select: { name: true } } },
        },
      },
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);

  return buildLegacyEntityIndex({
    elementTypes,
    projects,
    tasks: tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      lampId: t.lampId,
      process: t.process,
      lampElementId: t.lampElementId,
      areaLabel: t.lampElement?.elementType.name ?? null,
    })),
    users,
  });
}

export async function applyProyectoRows(
  rows: ProyectoRowDraft[],
): Promise<ProyectoApplySummary> {
  const summary: ProyectoApplySummary = {
    projectsCreated: 0,
    projectsUpdated: 0,
    projectsArchived: 0,
    lampsCreated: 0,
    lampsUpdated: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    skipped: 0,
  };

  const importable = rows.filter(
    (r) =>
      r.action !== "skip" &&
      r.processCode &&
      r.hrPlan != null &&
      r.projectName.trim() &&
      r.lampName.trim() &&
      r.frameTypeName.trim(),
  );
  summary.skipped = rows.length - importable.length;

  const processDefs = new Map<string, string>();
  for (const row of importable) {
    if (row.processCode) {
      processDefs.set(row.processCode, row.processName.trim() || row.processCode);
    }
  }

  const archiveProjectNames = new Set<string>();

  const [index, naveContext] = await Promise.all([
    loadApplyIndex(),
    loadTaskNaveContext(prisma),
  ]);

  await runImportTransaction(async (tx) => {
    const processResult = await ensureProcessDefinitions(
      tx,
      [...processDefs.entries()].map(([code, label]) => ({ code, label })),
    );
    void processResult;

    const taskOrderByLamp = new Map<string, number>();
    const touchedProjectIds = new Set<string>();

    for (const row of importable) {
      const elementType = matchElementTypeByBastidorName(index, row.frameTypeName);
      if (!elementType || !row.processCode || row.hrPlan == null) {
        summary.skipped += 1;
        continue;
      }

      const projectCode = projectCodeFromName(row.projectName);
      const archive = row.archiveProject || isTerminatedStatus(row.projectStatus);
      if (archive) archiveProjectNames.add(projectCode);

      const existingProject = await tx.project.findUnique({
        where: { code: projectCode },
        select: { id: true },
      });

      const project = await tx.project.upsert({
        where: { code: projectCode },
        update: {
          name: row.projectName.trim(),
          ...(row.deliveryDate ? { deliveryDate: row.deliveryDate } : {}),
          ...(archive ? { isActive: false } : {}),
        },
        create: {
          code: projectCode,
          name: row.projectName.trim(),
          deliveryDate: row.deliveryDate,
          isActive: !archive,
          approvalStatus: ProjectApprovalStatus.PENDING_APPROVAL,
        },
      });

      touchedProjectIds.add(project.id);

      if (existingProject) summary.projectsUpdated += 1;
      else summary.projectsCreated += 1;

      const lampFields = lampNameFields(row.lampName);
      const existingLamp = await tx.lamp.findUnique({
        where: {
          projectId_nameKey: {
            projectId: project.id,
            nameKey: lampFields.nameKey,
          },
        },
        select: { id: true },
      });

      const lamp = await tx.lamp.upsert({
        where: {
          projectId_nameKey: {
            projectId: project.id,
            nameKey: lampFields.nameKey,
          },
        },
        update: {
          name: lampFields.name,
          ...(row.surfaceM2 != null ? { surfaceM2: row.surfaceM2 } : {}),
        },
        create: {
          projectId: project.id,
          name: lampFields.name,
          nameKey: lampFields.nameKey,
          surfaceM2: row.surfaceM2,
        },
      });

      if (existingLamp) summary.lampsUpdated += 1;
      else summary.lampsCreated += 1;

      const lampElementExisting = await tx.lampElement.findFirst({
        where: { lampId: lamp.id, elementTypeId: elementType.id },
        select: { id: true },
      });

      const lampElement = lampElementExisting
        ? await tx.lampElement.update({
            where: { id: lampElementExisting.id },
            data: {
              ...(row.surfaceM2 != null ? { surfaceM2: row.surfaceM2 } : {}),
            },
          })
        : await tx.lampElement.create({
            data: {
              lampId: lamp.id,
              elementTypeId: elementType.id,
              surfaceM2: row.surfaceM2,
            },
          });

      const naveId = resolveNaveForElementType(
        elementType.id,
        naveContext.elementTypeDefaultNaves,
        naveContext.fallbackNaveId,
      );

      const orderKey = lamp.id;
      const order = taskOrderByLamp.get(orderKey) ?? 0;
      taskOrderByLamp.set(orderKey, order + 1);

      const scope = elementTaskScopeWhere({
        lampId: lamp.id,
        elementTypeId: elementType.id,
        process: row.processCode,
      });

      const existingTask = await tx.task.findFirst({
        where: scope,
        select: { id: true },
      });

      if (existingTask) {
        await tx.task.update({
          where: { id: existingTask.id },
          data: {
            estimatedHours: row.hrPlan,
            isCompleted: true,
            naveId,
            lampElementId: lampElement.id,
          },
        });
        summary.tasksUpdated += 1;
      } else {
        await tx.task.create({
          data: {
            projectId: project.id,
            lampId: lamp.id,
            lampElementId: lampElement.id,
            process: row.processCode,
            estimatedHours: row.hrPlan,
            isCompleted: true,
            order,
            naveId,
            notes: row.areaName ? `Área: ${row.areaName}` : undefined,
          },
        });
        summary.tasksCreated += 1;
      }
    }

    for (const code of archiveProjectNames) {
      const updated = await tx.project.updateMany({
        where: { code },
        data: { isActive: false },
      });
      summary.projectsArchived += updated.count;
    }

    for (const projectId of touchedProjectIds) {
      await syncProjectApprovalStatus(projectId, tx);
    }
  });

  return summary;
}
