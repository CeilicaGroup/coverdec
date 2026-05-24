# Arquitectura CoverDec MVP

## Visión general

Aplicación web monolito en **Next.js 16** (App Router) con **React Server Components** por defecto, **PostgreSQL** y **Prisma ORM**. La autenticación es **better-auth** (email/contraseña) con sesión en cookie. Validación con **Zod** y logs estructurados con **pino**.

## Multiempresa

Modelo **compartido**: un mismo equipo productivo atiende varias empresas del grupo. El aislamiento lógico se hace con `empresaId` en tablas transaccionales (`Project`, `Planning`, `TimeEntry`, `FactoryItem`, `ProductionOrder`, etc.). Personas, procesos, festivos y catálogo de bastidores son **globales**.

## Capas

1. **UI** (`src/app`): rutas públicas (`/login`) y área autenticada (`(dashboard)`). Shell con sidebar y navegación por semana.
2. **Server Actions** (`src/features/*/actions.ts`): mutaciones con `revalidatePath` tras cambios.
3. **Servicios de dominio** (`src/features/planning/service.ts`, importadores en `src/features/imports/`): orquestan Prisma y el motor de planning.
4. **Motor de planning** (`src/features/planning/engine/`): cliente HTTP al microservicio Python; tests en **Vitest** (greedy) y **pytest** (OR-Tools).

## Motor de planning (OR-Tools CP-SAT)

El reparto semanal usa un **microservicio Python** ([`services/planning-solver/`](services/planning-solver/)) con **OR-Tools CP-SAT**: intervalos opcionales por tarea/persona/día, sin solapamiento en persona ni lámpara, precedencia por bastidor, **tiempos de secado** (`ProcessDefinition.waitHours`) y objetivo multi-criterio ponderado por [`PlanningPolicy`](prisma/schema.prisma) (panel **Estrategia** en el resumen).

### Objetivos y restricciones (qué mueve el plan)

| Concepto | Tipo | Efecto |
|----------|------|--------|
| `ProcessDefinition.deadlineDay` | Restricción dura | No planificar ese proceso después del día de la semana (ej. imprimación ≤ miércoles). |
| `Project.deliveryDate` | Objetivo suave (`wLate`) | Penaliza acabar la lámpara después de la fecha de entrega del proyecto. |
| Precedencia por lámpara | Restricción dura | La tarea N+1 no empieza hasta que N esté totalmente asignada. |
| `waitHours` del proceso anterior | Restricción dura | Espera mínima entre procesos consecutivos (ej. 12 h tras imprimación). |
| `wUnscheduled` | Objetivo suave (tier 0) | Minimizar horas pendientes sin asignar en la semana. |
| `wLaborCost` | Objetivo suave (tier 2) | Minimizar coste de horas normales y extra. |
| `wLoadBalance` / `wMove` | Objetivo suave (tier 2) | Equilibrar carga entre operarios / estabilidad vs plan anterior. |

El solver usa **prioridades por tiers** (cobertura ×10⁶, plazos ×10³, coste ×1) para que un peso no pise a otro por accidente. Los floats del panel se traducen en `_coerce_weights` dentro de `solve_week.py`.

Los huecos «Libre» en el grid suelen ser capacidad que **no se puede usar** hasta que termine el proceso anterior de la misma lámpara (u otro operario), no necesariamente holgura ignorada por el optimizador.

La UI expone **Cumplir entregas** vs **Minimizar coste** (0–100), mapeados a pesos en [`policy-schema.ts`](src/features/planning/policy-schema.ts); el modo avanzado edita los pesos del solver directamente.

1. [`src/features/planning/service.ts`](src/features/planning/service.ts) carga datos con `loadSolverInput` y llama a `runPlanningEngine` (HTTP `POST /solve`).
2. [`services/planning-solver/app/model/solve_week.py`](services/planning-solver/app/model/solve_week.py) devuelve `PlanningAssignment` con `startSlot`/`endSlot` ya resueltos (una sola fase).
3. La persistencia en PostgreSQL ocurre en una transacción corta en Next.js (el solver corre fuera de la transacción).

Variable de entorno: `PLANNING_SOLVER_URL` (en Docker dev: `http://planning-solver:8000`; en host: `http://localhost:8000`).

El módulo greedy legado ([`scheduler.ts`](src/features/planning/engine/scheduler.ts)) permanece solo para tests de regresión en Node.

Reglas principales cubiertas por el motor: orden de tareas (entrega, prioridad, lámpara, `order` dentro de la lámpara), **precedencia por lámpara** (solo una tarea activa por bastidor; la siguiente empieza cuando la anterior queda totalmente asignada en la pasada), especialidad primaria o apoyo, tope de día laborable por persona, ausencias y festivos, partición de tareas largas en varios días.

## Proyectos, lámparas y tareas

- Cada **lámpara** tiene un **bastidor** (`frameTypeId`) fijado al crearla; no se puede cambiar (hay que borrar la lámpara y crear otra).
- Las **tareas** pertenecen siempre a una lámpara, en el **orden del bastidor** (`FrameTypeProcess.sequence` → `Task.order`). Se pueden añadir procesos extra al final.
- Al crear lámpara con bastidor y **Medida** (`surfaceM2`), se generan las tareas automáticamente.
- El **registro de horas** y el **planning** respetan la precedencia: no se puede imputar ni planificar un proceso si quedan horas pendientes en tareas anteriores de la misma lámpara.

Tests de referencia: [`src/features/planning/engine/__tests__/scheduler.test.ts`](src/features/planning/engine/__tests__/scheduler.test.ts).

## Planning: compromiso de horas

Al **generar** (o regenerar) un planning en borrador, las horas de cada `PlanningAssignment` se **descuentan** de `Task.pendingHours` en la misma transacción. Si se vuelve a generar la misma semana, primero se **restauran** las horas de las asignaciones anteriores de ese planning y luego se aplican las nuevas.

## Auth y roles

Roles en `User.role`: `ADMIN`, `JEFE_PRODUCCION`, `OPERARIO`. La empresa activa está en `User.activeEmpresaId`; el cambio se hace vía `POST /api/empresa/switch`. El proxy (`src/proxy.ts`) redirige a `/login` si no hay cookie de sesión.

## Despliegue

Imagen **Docker** multi-stage con `output: "standalone"`. Al arrancar se ejecuta `prisma migrate deploy` antes de `node server.js`. Ver `docs/deploy.md`.

## Datos iniciales

`prisma/seed.ts` crea procesos, personas, festivos 2026, tres empresas y un usuario admin (`admin@coverdec.local` / `admin12345` en desarrollo). Los Excel de `docs/` se importan con scripts en `scripts/import-excels.ts`.
