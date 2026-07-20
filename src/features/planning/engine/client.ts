import { childLogger } from "@/lib/logger";
import {
  formatNoCandidateWarning,
  isNoCandidateWarning,
  parseSolverResponse,
  serializeSolverInput,
  summarizeSolverRequest,
  solveResponseSchema,
  SolverInfeasibleError,
  SolverUnavailableError,
  type SolverInput,
} from "./solver-types";
import type { EngineResult } from "./types";

const log = childLogger({ module: "planning.solver-client" });

/** Margen sobre SOLVER_MAX_SECONDS para serialización y build del modelo CP-SAT. */
const SOLVER_HTTP_MARGIN_MS = 60_000;
const MIN_HTTP_TIMEOUT_MS = 240_000;
const DEFAULT_SOLVER_MAX_SECONDS = 240;
const TRANSIENT_SOLVER_RETRY_DELAY_MS = 750;

function formatSolverTimeoutMessage(reason: string): string {
  const budgetMatch = reason.match(/presupuesto\s+(\d+)s/i);
  const budgetText = budgetMatch?.[1]
    ? ` (${budgetMatch[1]}s de presupuesto)`
    : "";
  return (
    `El optimizador agotó el tiempo de cálculo${budgetText}. ` +
    "Regenera el planning o aumenta SOLVER_MAX_SECONDS en el entorno."
  );
}

function solverTimeoutMs(): number {
  const explicit = process.env.PLANNING_SOLVER_TIMEOUT_MS?.trim();
  if (explicit) {
    const parsed = Number(explicit);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(30_000, parsed);
    }
  }
  const solverSec = Number(process.env.SOLVER_MAX_SECONDS ?? DEFAULT_SOLVER_MAX_SECONDS);
  const fromSolver =
    (Number.isFinite(solverSec) ? solverSec : DEFAULT_SOLVER_MAX_SECONDS) *
      1000 +
    SOLVER_HTTP_MARGIN_MS;
  return Math.max(MIN_HTTP_TIMEOUT_MS, fromSolver);
}

function solverBaseUrl(): string {
  const url = process.env.PLANNING_SOLVER_URL?.trim();
  if (!url) {
    throw new SolverUnavailableError(
      "PLANNING_SOLVER_URL no está configurada. Arranca el servicio planning-solver (p. ej. docker compose up planning-solver).",
    );
  }
  return url.replace(/\/$/, "");
}

function isTransientSolverFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = `${err.name}: ${err.message}`.toLowerCase();
  return (
    message.includes("other side closed") ||
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
    message.includes("und_err_socket")
  );
}

function classifySolverNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return "No se pudo contactar con el solver de planning.";
  const message = `${err.name}: ${err.message}`.toLowerCase();
  if (message.includes("timeout") || message.includes("abort")) {
    return "No se pudo contactar con el solver: tiempo de espera agotado.";
  }
  if (message.includes("other side closed") || message.includes("socket")) {
    return "No se pudo contactar con el solver: el servicio cerró la conexión.";
  }
  return `No se pudo contactar con el solver: ${err.message}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callPlanningSolver(
  input: SolverInput,
): Promise<EngineResult> {
  const base = solverBaseUrl();
  const payload = serializeSolverInput(input);
  const solverUrl = `${base}/solve`;
  const started = Date.now();
  const body = JSON.stringify(payload);

  log.info(
    {
      solverUrl,
      planFrom: input.planFrom ?? null,
      deferredTaskCount: input.deferredTasks?.length ?? 0,
      payloadBytes: Buffer.byteLength(body, "utf8"),
      solverRequestSummary: summarizeSolverRequest(payload),
      solverRequest: payload,
    },
    "planning solver request",
  );

  let response: Response | null = null;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await fetch(solverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(solverTimeoutMs()),
      });
      break;
    } catch (err) {
      const transient = isTransientSolverFetchError(err);
      log.error(
        { err, base, attempt, maxAttempts, transient },
        "planning solver request failed",
      );
      if (!transient || attempt >= maxAttempts) {
        throw new SolverUnavailableError(classifySolverNetworkError(err));
      }
      await delay(TRANSIENT_SOLVER_RETRY_DELAY_MS);
    }
  }
  if (!response) {
    throw new SolverUnavailableError("No se pudo contactar con el solver de planning.");
  }

  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 800);
    try {
      const errJson = JSON.parse(text) as { detail?: unknown };
      if (errJson.detail) {
        detail = JSON.stringify(errJson.detail);
      }
    } catch {
      /* keep raw text */
    }
    log.warn({ status: response.status, body: detail }, "solver HTTP error");
    throw new SolverUnavailableError(
      response.status === 422
        ? `El solver rechazó la petición (datos inválidos): ${detail}`
        : `El solver respondió con error ${response.status}.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new SolverUnavailableError("Respuesta inválida del solver (JSON).");
  }

  const parsed = solveResponseSchema.safeParse(json);
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues }, "solver response validation failed");
    throw new SolverUnavailableError("Respuesta del solver con formato inesperado.");
  }

  const result = parseSolverResponse(parsed.data);
  log.info(
    {
      solveMs: Date.now() - started,
      assignments: result.assignments.length,
      unscheduledHours: result.unscheduledHours,
      warningCount: result.warnings.length,
      warnings: result.warnings.slice(0, 20),
      assignmentsSample: result.assignments.slice(0, 20).map((a) => ({
        taskId: a.taskId,
        personId: a.personId,
        date: a.date.toISOString().slice(0, 10),
        hours: a.hours,
        process: a.process,
      })),
    },
    "planning solver response ok",
  );

  const noCandidateWarnings = result.warnings.filter((w) =>
    isNoCandidateWarning(w.reason),
  );
  if (noCandidateWarnings.length > 0) {
    throw new SolverInfeasibleError(
      noCandidateWarnings.map((w) => formatNoCandidateWarning(w.taskId, w.reason)).join("\n"),
    );
  }

  if (
    result.assignments.length === 0 &&
    result.warnings.some((w) => w.reason.includes("factible"))
  ) {
    throw new SolverInfeasibleError(result.warnings[0]?.reason ?? "Sin solución factible.");
  }

  const timeoutWarning = result.warnings.find((w) =>
    w.reason.includes("solución a tiempo"),
  );
  if (result.assignments.length === 0 && timeoutWarning) {
    throw new SolverInfeasibleError(formatSolverTimeoutMessage(timeoutWarning.reason));
  }

  return result;
}
