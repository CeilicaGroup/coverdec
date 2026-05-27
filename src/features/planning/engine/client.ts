import { childLogger } from "@/lib/logger";
import {
  formatNoCandidateWarning,
  isNoCandidateWarning,
  parseSolverResponse,
  serializeSolverInput,
  solveResponseSchema,
  SolverInfeasibleError,
  SolverUnavailableError,
  type SolverInput,
} from "./solver-types";
import type { EngineResult } from "./types";

const log = childLogger({ module: "planning.solver-client" });

const DEFAULT_TIMEOUT_MS = 120_000;

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
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(`${base}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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

  return result;
}
