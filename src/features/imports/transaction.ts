import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

/** Imports can touch many rows; Prisma's default interactive tx timeout (5s) is too low. */
export const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

/**
 * La migración completa (catálogo + proyectos + horas) va en una sola transacción para que
 * un fallo en cualquier hoja no deje nada aplicado. Es una operación puntual de admin sobre
 * miles de filas: se le da margen amplio.
 */
export const FULL_MIGRATION_TRANSACTION_TIMEOUT_MS = 10 * 60_000;

/** Cliente de BD para importar: el global o el de una transacción en curso. */
export type ImportDb = Prisma.TransactionClient;

export async function runImportTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  timeoutMs = IMPORT_TRANSACTION_TIMEOUT_MS,
): Promise<T> {
  return prisma.$transaction(fn, { timeout: timeoutMs, maxWait: 30_000 });
}
