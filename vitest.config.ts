import { defineConfig } from "vitest/config";
import path from "node:path";
import { INTEGRATION_ENV } from "./src/test/integration/env";

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          root: __dirname,
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.int.test.ts", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        // Postgres + solver reales (docker-compose.test.yml). Sin mocks de prisma.
        resolve: { alias },
        test: {
          name: "integration",
          root: __dirname,
          include: ["src/**/*.int.test.ts"],
          environment: "node",
          globalSetup: ["./src/test/integration/global-setup.ts"],
          setupFiles: ["./src/test/integration/setup.ts"],
          // Una sola BD compartida: los ficheros no pueden correr en paralelo.
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 120_000,
          env: INTEGRATION_ENV,
        },
      },
    ],
  },
});
