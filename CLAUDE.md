# CLAUDE.md

@AGENTS.md

## What this is

CoverDec: internal production-management platform for a custom decorative-lighting workshop (3 sister companies sharing one plant, ~5 production staff). Replaces manual weekly planning (paper/HTML), a Google Sheets hours log, and Excel-based factory tracking. Full business context: [`docs/Proyecto.md`](docs/Proyecto.md). Architecture deep-dive: [`docs/architecture.md`](docs/architecture.md) (note: that doc calls the tenant field "empresa" — in the actual schema/code it is **`Nave`** / `naveId`, see below).

## Commands

```bash
npm run dev              # Next dev server
npm run dev:up           # full stack (web + db + planning-solver) via docker-compose.dev.yml
npm run dev:down
npm run dev:logs
npm run dev:seed         # seed inside the dev container

npm run build            # prisma generate && next build
npm run typecheck        # tsc --noEmit
npm run test             # vitest run (Node engine / greedy scheduler tests)
npx vitest run path/to/file.test.ts        # single test file
npx vitest run -t "test name"              # single test by name
npm run test:solver      # runs pytest for the OR-Tools microservice inside its container

npm run db:migrate       # prisma migrate dev
npm run db:deploy        # prisma migrate deploy
npm run db:seed
npm run db:reset         # prisma migrate reset --skip-seed
```

Solver-only test loop (faster than the docker-compose wrapper if you have a local Python env with `services/planning-solver/requirements-dev.txt` installed):

```bash
cd services/planning-solver && python -m pytest -q                # all
cd services/planning-solver && python -m pytest tests/test_solve_week.py -q -k some_case
```

There's no `lint` script — rely on `typecheck` and `test`.

## Architecture

Monolith: Next.js (App Router, RSC-first) + PostgreSQL/Prisma + a separate **Python microservice** for the planning solver.

- `src/app/(auth)`, `src/app/(dashboard)` — route groups. Dashboard pages are thin; real logic lives in `src/features/*`.
- `src/features/<domain>/actions.ts` — Server Actions (mutations), wrapped with `runServerAction` / `runAuditedMutation` from [`src/lib/server-action.ts`](src/lib/server-action.ts). Every action gets audit-logged (`AuditLog` model) and returns an `ActionResult<T>` ([`src/lib/action-result.ts`](src/lib/action-result.ts)) — never throw raw errors across the server/client boundary, use `actionOk`/`actionFail`.
- `src/features/<domain>/service.ts`, `queries.ts` — domain orchestration over Prisma.
- `src/features/planning/engine/` — HTTP client to the Python solver (`client.ts`); `scheduler.ts` is a **legacy greedy algorithm kept only for Node regression tests**, it is not what runs in production.
- `services/planning-solver/` — FastAPI + OR-Tools CP-SAT microservice, single `POST /solve` endpoint. Called from [`src/features/planning/service.ts`](src/features/planning/service.ts) via `PLANNING_SOLVER_URL`. Runs outside the DB transaction; persistence happens in a short Postgres transaction after the solve. Model lives in `services/planning-solver/app/model/`, tests in `services/planning-solver/tests/`.
- Prisma client is generated to a **non-default path**: `src/generated/prisma` (see `generator client { output = "../src/generated/prisma" }` in [`prisma/schema.prisma`](prisma/schema.prisma)). Always `import { PrismaClient, ... } from "@/generated/prisma"`, never `@prisma/client`. Import the singleton from `@/lib/db`.
- Auth: `better-auth` (email/password) via [`src/lib/auth.ts`](src/lib/auth.ts), Prisma adapter, roles on `User.role` (`ADMIN`, `JEFE_PRODUCCION`, `OPERARIO`). Session gating happens in `src/proxy.ts`, not in page components.

### Multi-tenant model: `Nave`, not "empresa"

Despite `docs/architecture.md` describing an "empresa"/`empresaId` model, the real scoping entity in the schema is **`Nave`** (`naveId`), e.g. `PlanningPolicy.naveId`, `User.activeNaveId`, `PersonNave`, `Task.naveId`, `Planning.naveId`, `Notification.naveId`. `Person`, `ProcessDefinition`, `ElementType`/`ElementTypeProcess` (mostly) and `Holiday` are global. Notably `Project` and `TimeEntry` do **not** carry `naveId` directly — check how a feature scopes by nave before assuming a direct column exists.

### Planning engine — domain rules that live across multiple files

The solver's constraints/objectives (hard rules: no overlap per person/lamp, precedence, `waitHours` drying time, `minWeekQuarter`; soft objectives: lateness, unscheduled hours, labor cost, load balance) are documented in full in [`docs/architecture.md`](docs/architecture.md) — read it before touching anything under `src/features/planning/` or `services/planning-solver/app/model/`. Key entry points: `load-engine-input.ts` (builds solver input, precomputes `minWeekQuarter`), `service.ts` (`loadSolverInput` → `runPlanningEngine`), `policy-schema.ts` (UI sliders ↔ solver weights), `solve_week.py` (`_coerce_weights`, tiered objective), `timeline.py` (`WorkerPlacementCatalog`).

Domain hierarchy: `Project` → `Lamp` (fixed `frameTypeId` at creation, can't change) → `Task` (one per process per unit, ordered by `FrameTypeProcess.sequence`). See [`docs/lampas-agregacion.md`](docs/lampas-agregacion.md) for how multi-unit lamps are stored (one row per unit/process, never pre-aggregated) vs. displayed (aggregated views are UI-only). Generating/regenerating a draft planning debits `Task.pendingHours` inside the same transaction; regenerating the same week restores prior hours first.

Feature flags for solver rollout (`PLANNING_SOLVER_ENABLE_COMPONENT_PARTITION`, `PLANNING_SOLVER_NO_INTERLEAVE_MODE`) — see [`docs/planning-solver-canary-rollout.md`](docs/planning-solver-canary-rollout.md) before changing solver behavior in a shared environment.

### Notifications worker

`src/worker/notifications.ts` runs standalone (`npm run worker:notifications`, `tsx`), separate from the Next.js process — not invoked from within request handling.

### Deploy

Docker multi-stage, `output: "standalone"`. The container CMD runs `prisma migrate deploy` before `node server.js` — if an orchestrator (e.g. Coolify) overrides the start command to just `node server.js`, migrations silently don't run and the dashboard fails with a masked Next.js production error. See [`docs/deploy.md`](docs/deploy.md) for required env vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, `PLANNING_SOLVER_URL`).

## Code conventions (from `.cursorrules`, condensed)

- Prisma types from `@/generated/prisma`, client from `@/lib/db` — always, per above.
- Prefer Server Components; minimize `use client`; mutations go through Server Actions, not route handlers, unless there's a specific reason (webhooks, etc.).
- `zod` for all validation, `pino` for all logging (structured; use `childLogger` for module context, see `src/lib/logger.ts`). Always log warnings/errors.
- Prefer interfaces over `type`, avoid enums in TS code (Prisma enums in the schema are fine), avoid `any`/`unknown` unless truly needed.
- UI components come from `shadcn/ui` (`npx shadcn@latest add <component>`), never import Radix directly.
- Client-side data fetching (when it can't happen in a parent Server Component) uses React Query.
