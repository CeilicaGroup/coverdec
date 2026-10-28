import { execSync } from "node:child_process";
import { INTEGRATION_ENV } from "./env";

/** Guardarraíl: nunca vaciar una BD que no sea la de tests. */
export function assertTestDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (!url.pathname.endsWith("_test")) {
    throw new Error(`Refusing to touch non-test database: ${url.host}${url.pathname}`);
  }
}

/**
 * Aplica migraciones pendientes y comprueba que el solver real responde.
 * La BD vive en tmpfs (se crea vacía con `test:int:up`) y setup.ts vacía las tablas
 * antes de cada test, así que no hace falta `migrate reset`.
 */
export default async function globalSetup(): Promise<void> {
  // globalSetup corre en el proceso principal: test.env no llega aquí.
  assertTestDatabase(INTEGRATION_ENV.DATABASE_URL);

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, ...INTEGRATION_ENV },
    stdio: "inherit",
  });

  const solverUrl = INTEGRATION_ENV.PLANNING_SOLVER_URL;
  const health = await fetch(`${solverUrl}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Planning solver no responde en ${solverUrl}. Ejecuta: npm run test:int:up`);
  }
}
