import type { Prisma } from "@/generated/prisma";
import { getImprevistasPoolProjectId } from "./imprevistas-pool";
import { IMPREVISTAS_LAMP_NAME, IMPREVISTAS_LAMP_NAME_KEY } from "./constants";

export async function getOrCreateImprevistasLamp(
  tx: Prisma.TransactionClient,
): Promise<{ id: string; projectId: string }> {
  const projectId = await getImprevistasPoolProjectId(tx);

  const existing = await tx.lamp.findUnique({
    where: {
      projectId_nameKey: {
        projectId,
        nameKey: IMPREVISTAS_LAMP_NAME_KEY,
      },
    },
    select: { id: true, projectId: true },
  });
  if (existing) return existing;

  const created = await tx.lamp.create({
    data: {
      projectId,
      name: IMPREVISTAS_LAMP_NAME,
      nameKey: IMPREVISTAS_LAMP_NAME_KEY,
      units: 1,
    },
    select: { id: true, projectId: true },
  });
  return created;
}

export function isImprevistasLamp(lamp: { nameKey: string }): boolean {
  return lamp.nameKey === IMPREVISTAS_LAMP_NAME_KEY;
}
