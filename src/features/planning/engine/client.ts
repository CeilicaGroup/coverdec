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

export async function callPlanningSolver(
  input: SolverInput,
): Promise<EngineResult> {
  const base = solverBaseUrl();
  const payload = serializeSolverInput(input);
  const solverUrl = `${base}/solve`;
  const started = Date.now();

  log.info(
    {
      solverUrl,
      planFrom: input.planFrom ?? null,
      deferredTaskCount: input.deferredTasks?.length ?? 0,
      solverRequestSummary: summarizeSolverRequest(payload),
      solverRequest: payload,
    },
    "planning solver request",
  );

  let response: Response;
  try {
    response = await fetch(solverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(solverTimeoutMs()),
    });
  } catch (err) {
    log.error({ err, base }, "planning solver request failed");
    throw new SolverUnavailableError(
      err instanceof Error
        ? `No se pudo contactar con el solver: ${err.message}`
        : "No se pudo contactar con el solver de planning.",
    );
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
