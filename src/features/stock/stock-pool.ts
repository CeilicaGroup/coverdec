import type { Prisma } from "@/generated/prisma";
import { ProjectKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export const STOCK_POOL_PROJECT_CODE = "STOCK-POOL";

export async function getStockPoolProjectId(
  db: Pick<Prisma.TransactionClient, "project"> | typeof prisma = prisma,
): Promise<string> {
  const project = await db.project.findUnique({
    where: { code: STOCK_POOL_PROJECT_CODE },
    select: { id: true, kind: true },
  });
  if (!project || project.kind !== ProjectKind.STOCK) {
    throw new Error("No está configurado el proyecto pool de stock (STOCK-POOL).");
  }
  return project.id;
}
