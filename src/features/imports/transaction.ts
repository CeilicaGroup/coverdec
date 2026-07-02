import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

/** Imports can touch many rows; Prisma's default interactive tx timeout (5s) is too low. */
export const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

export async function runImportTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, { timeout: IMPORT_TRANSACTION_TIMEOUT_MS });
}
