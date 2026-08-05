import type { Prisma } from "@/generated/prisma";
import { getOrCreateImprevistasLamp } from "./imprevistas-lamp";

export async function resolveAdHocProjectLamp(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<{ projectId: string; lampId: string }> {
  const project = await tx.project.findFirst({
    where: { id: projectId, isActive: true },
    include: {
      lamps: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } },
    },
  });
  if (!project) throw new Error("Proyecto no encontrado.");

  if (project.lamps[0]) {
    return { projectId: project.id, lampId: project.lamps[0].id };
  }

  const pool = await getOrCreateImprevistasLamp(tx);
  return { projectId: project.id, lampId: pool.id };
}
