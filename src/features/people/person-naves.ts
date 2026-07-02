import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export function assertSingleNaveId(naveIds: string[]): string {
  const unique = [...new Set(naveIds)];
  if (unique.length !== 1) {
    throw new Error("Cada operario debe tener exactamente una nave asignada.");
  }
  return unique[0]!;
}

/** Asigna una única nave a la persona (reemplaza cualquier asignación previa). */
export async function setPersonNave(
  personId: string,
  naveId: string,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  await db.personNave.deleteMany({ where: { personId } });
  await db.personNave.create({
    data: { personId, naveId },
  });
}

/** @deprecated Use setPersonNave — mantiene compatibilidad con array de longitud 1. */
export async function replacePersonNaves(
  personId: string,
  naveIds: string[],
  tx?: Prisma.TransactionClient,
) {
  const naveId = assertSingleNaveId(naveIds);
  await setPersonNave(personId, naveId, tx);
}

export function personNaveIds(
  person: { personNaves: { naveId: string }[] } | null | undefined,
): string[] {
  return person?.personNaves.map((pn) => pn.naveId) ?? [];
}

export function personNaveId(
  person: { personNaves: { naveId: string }[] } | null | undefined,
): string | null {
  const ids = personNaveIds(person);
  return ids[0] ?? null;
}

/** Si hay varias filas legacy, conserva la de codigo menor (misma regla que el backfill). */
export function pickCanonicalPersonNave<
  T extends { naveId: string; nave: { codigo: string } },
>(personNaves: T[]): T | null {
  if (personNaves.length === 0) return null;
  return [...personNaves].sort((a, b) =>
    a.nave.codigo.localeCompare(b.nave.codigo),
  )[0]!;
}
