import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export async function replacePersonNaves(
  personId: string,
  naveIds: string[],
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const unique = [...new Set(naveIds)];
  await db.personNave.deleteMany({ where: { personId } });
  if (unique.length === 0) return;
  await db.personNave.createMany({
    data: unique.map((naveId) => ({ personId, naveId })),
  });
}

export function personNaveIds(
  person: { personNaves: { naveId: string }[] } | null | undefined,
): string[] {
  return person?.personNaves.map((pn) => pn.naveId) ?? [];
}
