import { prisma } from "@/lib/db";
import {
  buildLegacyEntityIndex,
  matchElementTypeByBastidorName,
  matchLampByName,
  matchProjectByName,
  matchTask,
  projectCodeFromName,
  taskLookupKey,
} from "./match-legacy-entities";
import type {
  ImportAction,
  ImportPreview,
  ImportPreviewSummary,
  ImportRowStatus,
  ProyectoRowDraft,
} from "./types";

function buildSummary(rows: ProyectoRowDraft[]): ImportPreviewSummary {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === "ok").length,
    warning: rows.filter((r) => r.status === "warning").length,
    error: rows.filter((r) => r.status === "error").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    willCreate: rows.filter((r) => r.action === "create").length,
    willUpdate: rows.filter((r) => r.action === "update").length,
    willSkip: rows.filter((r) => r.action === "skip").length,
  };
}

async function loadEntityIndex() {
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
          select: {
            elementType: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
    }),
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

export async function enrichProyectoPreview(
  rows: ProyectoRowDraft[],
): Promise<ImportPreview<ProyectoRowDraft>> {
  const index = await loadEntityIndex();
  const seenTaskKeys = new Set<string>();

  const enriched = rows.map((row) => {
    if (row.status === "skipped") return row;

    const issues = [...row.issues];
    let elementTypeId: string | null = null;
    let elementTypeName: string | null = null;
    let projectId: string | null = null;
    let lampId: string | null = null;
    let taskId: string | null = null;
    let action: ImportAction = row.action;

    if (row.frameTypeName) {
      const et = matchElementTypeByBastidorName(index, row.frameTypeName);
      if (!et) {
        issues.push({
          code: "UNKNOWN_FRAME_TYPE",
          field: "frameTypeName",
          message: `Tipo de bastidor no encontrado en catálogo: "${row.frameTypeName}"`,
          severity: "error",
        });
      } else {
        elementTypeId = et.id;
        elementTypeName = et.name;
      }
    }

    const existingProject = row.projectName
      ? matchProjectByName(index, row.projectName)
      : null;
    if (existingProject) {
      projectId = existingProject.id;
    }

    if (existingProject && row.lampName) {
      const lamp = matchLampByName(index, existingProject.id, row.lampName);
      if (lamp) lampId = lamp.id;
    }

    if (projectId && lampId && row.processCode) {
      const task = matchTask({
        index,
        projectId,
        lampId,
        process: row.processCode,
        areaName: row.areaName,
      });
      if (task) {
        taskId = task.id;
        action = "update";
      } else {
        action = "create";
      }
    } else if (!issues.some((i) => i.severity === "error")) {
      action = existingProject ? "update" : "create";
    }

    if (row.processCode && projectId && lampId) {
      const dupKey = taskLookupKey({
        projectId,
        lampId,
        process: row.processCode,
      });
      if (seenTaskKeys.has(dupKey) && row.status === "ok") {
        issues.push({
          code: "DUPLICATE_IN_FILE",
          message: "Fila duplicada (mismo proyecto, lámpara y proceso)",
          severity: "warning",
        });
      }
      seenTaskKeys.add(dupKey);
    }

    if (!existingProject && row.projectName) {
      const code = projectCodeFromName(row.projectName);
      if (index.projectsByKey.has(code)) {
        issues.push({
          code: "PROJECT_CODE_COLLISION",
          message: `El código derivado "${code}" ya existe con otro nombre`,
          severity: "warning",
        });
      }
    }

    const hasError = issues.some((i) => i.severity === "error");
    const hasWarning = issues.some((i) => i.severity === "warning");
    const status: ImportRowStatus = hasError
      ? "error"
      : hasWarning
        ? "warning"
        : "ok";

    if (hasError) action = "skip";

    return {
      ...row,
      elementTypeId,
      elementTypeName,
      projectId,
      lampId,
      taskId,
      issues,
      status,
      action,
    };
  });

  return { rows: enriched, summary: buildSummary(enriched) };
}

export function mergeProyectoRowEdits(
  rows: ProyectoRowDraft[],
  edits: Array<{ rowIndex: number; patch: Partial<ProyectoRowDraft> }>,
): ProyectoRowDraft[] {
  const byIndex = new Map(edits.map((e) => [e.rowIndex, e.patch]));
  return rows.map((row) => {
    const patch = byIndex.get(row.rowIndex);
    if (!patch) return row;
    return { ...row, ...patch };
  });
}
