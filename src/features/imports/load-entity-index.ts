import { prisma } from "@/lib/db";
import { buildLegacyEntityIndex, type LegacyEntityIndex } from "./match-legacy-entities";
import type { ImportDb } from "./transaction";

/** Catálogo, proyectos, tareas y usuarios para emparejar filas legacy (dentro o fuera de una tx). */
export async function loadLegacyEntityIndex(db: ImportDb = prisma): Promise<LegacyEntityIndex> {
  const [elementTypes, projects, tasks, users] = await Promise.all([
    db.elementType.findMany({
      select: { id: true, name: true, code: true },
    }),
    db.project.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        lamps: { select: { id: true, name: true, nameKey: true, projectId: true } },
      },
    }),
    db.task.findMany({
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
    db.user.findMany({
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
