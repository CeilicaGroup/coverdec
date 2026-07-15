import type { Prisma } from "@/generated/prisma";
import { getImprevistasPoolProjectId } from "./imprevistas-pool";
import { IMPREVISTAS_LAMP_NAME, IMPREVISTAS_LAMP_NAME_KEY } from "./constants";

export async function getOrCreateImprevistasLamp(
  tx: Prisma.TransactionClient,
): Promise<{ id: string; projectId: string }> {
  const projectId = await getImprevistasPoolProjectId(tx);

  return tx.lamp.upsert({
    where: {
      projectId_nameKey: {
        projectId,
        nameKey: IMPREVISTAS_LAMP_NAME_KEY,
      },
    },
    create: {
      projectId,
      name: IMPREVISTAS_LAMP_NAME,
      nameKey: IMPREVISTAS_LAMP_NAME_KEY,
      units: 1,
    },
    update: {},
    select: { id: true, projectId: true },
  });
}

export function isImprevistasLamp(lamp: { nameKey: string }): boolean {
  return lamp.nameKey === IMPREVISTAS_LAMP_NAME_KEY;
}
