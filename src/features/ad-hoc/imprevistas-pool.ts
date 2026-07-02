import type { Prisma } from "@/generated/prisma";
import { ProjectKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export const IMPREVISTAS_POOL_PROJECT_CODE = "IMPREVISTAS-POOL";

export async function getImprevistasPoolProjectId(
  db: Pick<Prisma.TransactionClient, "project"> | typeof prisma = prisma,
): Promise<string> {
  const project = await db.project.findUnique({
    where: { code: IMPREVISTAS_POOL_PROJECT_CODE },
    select: { id: true, kind: true },
  });
  if (!project || project.kind !== ProjectKind.IMPREVISTAS) {
    throw new Error(
      "No está configurado el proyecto pool de imprevistas (IMPREVISTAS-POOL).",
    );
  }
  return project.id;
}
