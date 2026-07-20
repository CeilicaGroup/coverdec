# Planning Solver Canary Rollout

This rollout keeps planner behavior stable while reducing timeout and socket-closed errors.

## Feature flags

- `PLANNING_SOLVER_ENABLE_COMPONENT_PARTITION` (default: `false`)
- `PLANNING_SOLVER_NO_INTERLEAVE_MODE` (default: `legacy`, optional `compact`)

Both flags are safe to keep disabled. They are wired for controlled activation.

## Phase 1: Baseline and quick wins

1. Deploy with defaults (`partition=false`, `no_interleave=legacy`).
2. Collect solver metrics for at least one business day:
   - `tasks`, `people`, `candidatePairs`, `fixed`, `busy`, `previous`
   - `prepareMs`, `modelBuildMs`, `solveMs`, `totalMs`
3. Compare against previous p95/p99 latency and failure ratios.

## Phase 2: Canary by scope

1. Pick one low-risk canary scope (single environment or narrow operator group).
2. Keep functional mode unchanged; only validate stability improvements from quick wins.
3. Monitor:
   - `SolverUnavailableError` rate
   - `fetch failed`, `other side closed`, timeout occurrences
   - container restarts/OOM in `planning-solver`

## Phase 3: Experimental flags (optional)

1. Enable one flag at a time:
   - first `PLANNING_SOLVER_NO_INTERLEAVE_MODE=compact`
   - then `PLANNING_SOLVER_ENABLE_COMPONENT_PARTITION=true` (when implemented)
2. Run side-by-side validation on representative weeks.
3. Validate equivalence:
   - assignment set (normalized ordering)
   - `unscheduledHours`
   - critical warnings

## Kill switch

If mismatch or instability appears, immediately revert to:

- `PLANNING_SOLVER_ENABLE_COMPONENT_PARTITION=false`
- `PLANNING_SOLVER_NO_INTERLEAVE_MODE=legacy`

No schema/data migration is required for rollback.
