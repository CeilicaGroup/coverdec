import pino, { type Logger } from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  base: {
    service: "coverdec",
    env: process.env.NODE_ENV ?? "development",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }),
});

export const childLogger = (bindings: Record<string, unknown>): Logger =>
  logger.child(bindings);
