import { afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "./global-setup";
import { requestHeaders, resetSession } from "./world";

assertTestDatabase(process.env.DATABASE_URL ?? "");

// Solo se falsea la frontera HTTP de Next: cabeceras de la petición y caché de rutas.
// Sesión, permisos, Prisma, transacciones y solver son los reales.
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: <T>(fn: T) => fn,
}));

let tables: string[] | null = null;

/** Vacía todas las tablas antes de cada test: cada test monta su propio mundo. */
beforeEach(async () => {
  resetSession();
  tables ??= (
    await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  ).map((r) => `"public"."${r.tablename}"`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
