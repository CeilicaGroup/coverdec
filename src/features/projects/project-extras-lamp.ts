import type { Prisma } from "@/generated/prisma";

export const PROJECT_EXTRAS_LAMP_NAME = "Procesos del proyecto";
export const PROJECT_EXTRAS_LAMP_NAME_KEY = "__project_extras__";

export async function getOrCreateProjectExtrasLamp(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<{ id: string; projectId: string }> {
  return tx.lamp.upsert({
    where: {
      projectId_nameKey: {
        projectId,
        nameKey: PROJECT_EXTRAS_LAMP_NAME_KEY,
      },
    },
    create: {
      projectId,
      name: PROJECT_EXTRAS_LAMP_NAME,
      nameKey: PROJECT_EXTRAS_LAMP_NAME_KEY,
      units: 1,
      isApprovedForPlanning: false,
    },
    update: {},
    select: { id: true, projectId: true },
  });
}

export function isProjectExtrasLamp(lamp: { nameKey: string }): boolean {
  return lamp.nameKey === PROJECT_EXTRAS_LAMP_NAME_KEY;
}
