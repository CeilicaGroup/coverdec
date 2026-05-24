import { callPlanningSolver } from "./client";
import type { SolverInput } from "./solver-types";
import type { EngineResult } from "./types";

export type {
  EngineAssignment,
  EngineInput,
  EngineResult,
  EngineTask,
} from "./types";
export type { SolverInput } from "./solver-types";
export {
  SolverInfeasibleError,
  SolverUnavailableError,
} from "./solver-types";
export { serializeSolverInput } from "./solver-types";

export async function runPlanningEngine(input: SolverInput): Promise<EngineResult> {
  return callPlanningSolver(input);
}
