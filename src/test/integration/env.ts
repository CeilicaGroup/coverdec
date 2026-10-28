/** Entorno de los tests de integración (docker-compose.test.yml). Lo usan vitest.config y globalSetup. */
export const INTEGRATION_ENV = {
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://coverdec:coverdec@localhost:5434/coverdec_test?schema=public",
  PLANNING_SOLVER_URL: process.env.TEST_PLANNING_SOLVER_URL ?? "http://localhost:8001",
  SOLVER_MAX_SECONDS: "60",
  BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  // Muchos tests provocan errores a propósito; LOG_LEVEL=error para depurar.
  LOG_LEVEL: process.env.LOG_LEVEL ?? "silent",
  NODE_ENV: "test" as const,
};
