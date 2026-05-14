# Arquitectura CoverDec MVP

## Visión general

Aplicación web monolito en **Next.js 16** (App Router) con **React Server Components** por defecto, **PostgreSQL** y **Prisma ORM**. La autenticación es **better-auth** (email/contraseña) con sesión en cookie. Validación con **Zod** y logs estructurados con **pino**.

## Multiempresa

Modelo **compartido**: un mismo equipo productivo atiende varias empresas del grupo. El aislamiento lógico se hace con `empresaId` en tablas transaccionales (`Project`, `Planning`, `TimeEntry`, `FactoryItem`, `ProductionOrder`, etc.). Personas, procesos, festivos y catálogo de bastidores son **globales**.

## Capas

1. **UI** (`src/app`): rutas públicas (`/login`) y área autenticada (`(dashboard)`). Shell con sidebar y navegación por semana.
2. **Server Actions** (`src/features/*/actions.ts`): mutaciones con `revalidatePath` tras cambios.
3. **Servicios de dominio** (`src/features/planning/service.ts`, importadores en `src/features/imports/`): orquestan Prisma y el motor de planning.
4. **Motor de planning** (`src/features/planning/engine/`): scheduler determinista con tests en **Vitest**.

## Motor de planning (greedy, no solver CSP/ILP)

El reparto semanal **no** usa un motor de restricciones genérico (no CSP, no programación lineal entera, no OR-Tools). El flujo es:

1. [`src/features/planning/service.ts`](src/features/planning/service.ts) carga tareas pendientes, personas con especialidades, definiciones de proceso, ausencias y festivos, y llama a `runScheduler`.
2. [`src/features/planning/engine/scheduler.ts`](src/features/planning/engine/scheduler.ts) implementa un **planificador voraz determinista**: ordena tareas y, para cada asignación, elige entre candidatos válidos quien lleve **menos horas acumuladas en la semana** (desempate por `personId`), respetando cupo diario, `deadlineDay` por proceso y la regla primario → sustituto (`pickCandidates`).
3. Los resultados se persisten como `PlanningAssignment`.

Reglas principales cubiertas por el motor: orden de tareas (entrega, prioridad, secuencia de proceso), especialidad primaria o apoyo, tope de día laborable por persona, ausencias y festivos, partición de tareas largas en varios días.

Tests de referencia: [`src/features/planning/engine/__tests__/scheduler.test.ts`](src/features/planning/engine/__tests__/scheduler.test.ts).

## Planning: compromiso de horas y orden por semanas

- Al **generar** (o regenerar) un planning en borrador, las horas de cada `PlanningAssignment` se **descuentan** de `Task.pendingHours` en la misma transacción. Si se vuelve a generar la misma semana, primero se **restaurán** las horas de las asignaciones anteriores de ese planning y luego se aplican las nuevas.
- Solo se puede generar la **semana ISO siguiente** si existe un planning para la semana anterior **y** la suma de horas de sus asignaciones es **≥ 40 h** (constante `MIN_PLANNED_HOURS_PREVIOUS_WEEK` en [`service.ts`](src/features/planning/service.ts)). Si no hay planning de la semana anterior, se permite generar (arranque de la cadena).

## Auth y roles

Roles en `User.role`: `ADMIN`, `JEFE_PRODUCCION`, `OPERARIO`. La empresa activa está en `User.activeEmpresaId`; el cambio se hace vía `POST /api/empresa/switch`. El proxy (`src/proxy.ts`) redirige a `/login` si no hay cookie de sesión.

## Despliegue

Imagen **Docker** multi-stage con `output: "standalone"`. Al arrancar se ejecuta `prisma migrate deploy` antes de `node server.js`. Ver `docs/deploy.md`.

## Datos iniciales

`prisma/seed.ts` crea procesos, personas, festivos 2026, tres empresas y un usuario admin (`admin@coverdec.local` / `admin12345` en desarrollo). Los Excel de `docs/` se importan con scripts en `scripts/import-excels.ts`.
