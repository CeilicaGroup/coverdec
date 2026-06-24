# Planning coordinado multi-nave

> **Prerequisito** para [`rutas-multinave.md`](rutas-multinave.md) y cualquier lámpara cuya cadena de `Task` cruce naves.

## Problema

Hoy la generación de planning es **por nave aislada**:

```typescript
// src/features/planning/actions.ts
if (!ctx.naveId) throw new Error("Selecciona una nave antes de planificar");
await generatePlanning({ naveId: ctx.naveId, ... });
```

Consecuencias:

1. **Tareas filtradas por nave** — `loadSolverInput` usa `where: { naveId: args.naveId }`.
2. **Precedencia incompleta** — `computeMinWeekQuarterByTaskId` agrupa por `lampId`, pero solo ve tareas de la nave actual; predecesoras en otra nave no restringen el inicio.
3. **Prior semanal por nave** — `priorWeekAssignments` se cargan solo de la misma nave.
4. **Generación manual secuencial** — Si el jefe genera N1, luego N2, luego N3, cada paso ignora la cadena global de la lámpara.

### Lo que ya existe (parcial)

`crossNaveAssignments` en [`load-engine-input.ts`](../../src/features/planning/load-engine-input.ts): bloquea solapamiento de **personas** asignadas en otra nave la misma semana. **No** coordina precedencia de tareas entre naves.

## Casos de fallo

| Escenario | Qué falla |
|-----------|-----------|
| **Selcos MC (tipo 2)** | N2 (cierre bastidor) se planifica antes de que N3 termine iluminación |
| **Cruz (tipo 3)** | Tres naves en paralelo con misma `deliveryDate`; cada nave optimiza por separado → entrega incoherente |
| **Secuencia tela→bastidor→LED** | `Task.order` cruza naves; `minWeekQuarter` en N2 no ve fin de tareas N1 |
| **Horizonte multi-semana** | `prepareHorizonGeneration` itera por nave activa del usuario, no coordina |

## Objetivo

**Una acción de generación** produce borradores **sincronizados** para todas las naves activas de la semana, con un único paso de solver que respeta:

- Precedencia global por `lampId` + `order`
- Aristas duras N3→N2 en rutas tipo SEQ
- Sin solapamiento de operarios (incl. multi-nave)
- Políticas de peso del solver por nave o fusionadas

## Enfoque propuesto

### 1. Generación conjunta

Nueva función `generateCoordinatedPlanning`:

```typescript
interface GenerateCoordinatedPlanningArgs {
  weekStart: Date;
  naveIds?: string[];  // default: todas las naves activas
  planFrom?: PlanFrom;
  planFromAt?: Date;
  replaceDraft?: boolean;
}
```

- Sustituye o complementa `generatePlanning` cuando el alcance es multi-nave.
- Transacción atómica: todas las naves en borrador o ninguna.

### 2. Solver multi-nave

Extender `loadSolverInput`:

| Carga actual | Cambio |
|--------------|--------|
| `tasksRaw` filtrado por `naveId` | `naveId: { in: naveIds }` |
| `peopleRaw` de una nave | Personas con `personNaves` en cualquier nave del alcance |
| Candidatos por tarea | Solo operarios de `task.naveId` |
| `priorWeekAssignments` | Unión de asignaciones previas de **todas** las naves |
| `minWeekQuarter` | Incluir tareas predecesoras de **todas** las naves del mismo `lampId` |

Para `computeMinWeekQuarterByTaskId`, pasar el conjunto completo de tareas de las lámparas afectadas, no solo las del solver actual.

### 3. Aristas inter-nave (rutas SEQ)

Para lámparas con `routeType = 2`:

- Identificar última tarea N3 y primera tarea N2 de la secuencia (por catálogo o `order`).
- Añadir restricción dura en solver: `start(N2_first) >= end(N3_last) + waitHours`.

Parametrizar en catálogo (`ElementType` o tabla `LampRoute`).

### 4. Persistencia

Una ejecución del solver devuelve asignaciones para tareas de varias naves.

```
Para cada naveId en naveIds:
  Planning.upsert({ naveId, year, week })
  PlanningAssignment.createMany(...)  // solo task.naveId === naveId
```

Opcional: `PlanningBatch` o `planningGroupId` (UUID común) para vincular borradores de la misma generación.

| Con grupo | Sin grupo |
|-----------|-----------|
| Deshacer/publicar coordinado | Más simple de modelo |
| Trazabilidad de generación | Menos migración |

**Recomendación:** añadir `planningGroupId String?` en `Planning` para publicar/deshacer coordinado.

### 5. Políticas (`PlanningPolicy`)

Cada nave tiene pesos propios. Opciones documentadas:

- **Por nave en solver** — usar pesos de la nave de cada tarea (recomendado)
- **Global** — promedio de pesos de naves del alcance
- **Dominante** — pesos de la nave con más horas pendientes

### 6. UI

| Contexto | Comportamiento |
|----------|----------------|
| Vista «Todas las naves» | Botón **Generar planning (todas las naves)** |
| Vista nave única | Aviso si hay dependencias SEQ cross-nave: «Genera desde vista global» |
| Resumen semana | Indicador de grupo coordinado (mismo `planningGroupId`) |
| Publicar | Opción publicar grupo completo o por nave (definir: **recomendado grupo completo**) |

### 7. Horizonte multi-semana

`prepareHorizonGenerationAction` debe llamar a `generateCoordinatedPlanning` por cada semana del horizonte, no iterar naves por separado.

## Alternativas descartadas

| Alternativa | Motivo de descarte |
|-------------|-------------------|
| Generar N1→N2→N3 en secuencia manual | No resuelve rutas paralelas con entrega conjunta |
| Solo inyectar `minWeekQuarter` externo sin solver unificado | No optimiza plazos globalmente; conflictos de capacidad |
| Un solo `Planning` sin `naveId` | Rompe modelo actual, permisos y UI por nave |

## Criterios de aceptación

- [ ] Generar semana X con 3 naves activas crea 3 `Planning` borrador en una acción
- [ ] Tarea N2 de lámpara SEQ no tiene asignación antes del fin de N3 (+ secado)
- [ ] Operario en N1 y N2 no recibe bloques solapados (regresión `crossNaveAssignments`)
- [ ] `planningGroupId` igual en los 3 plannings de una generación coordinada
- [ ] Deshacer grupo elimina/revierte los 3 borradores
- [ ] Tests pytest/Vitest: lámpara SEQ, lámpara paralela 3 naves, persona multi-nave

## Archivos a modificar (implementación futura)

| Archivo | Cambio |
|---------|--------|
| [`src/features/planning/actions.ts`](../../src/features/planning/actions.ts) | `generateCoordinatedPlanningAction` |
| [`src/features/planning/service.ts`](../../src/features/planning/service.ts) | Orquestación multi-nave, persistencia split |
| [`src/features/planning/load-engine-input.ts`](../../src/features/planning/load-engine-input.ts) | Alcance multi-nave, tareas globales para precedencia |
| [`src/features/planning/prior-week-planning.ts`](../../src/features/planning/prior-week-planning.ts) | Prior cross-nave |
| [`services/planning-solver/`](../../services/planning-solver/) | Restricción candidatos por `task.naveId`; aristas SEQ |
| [`prisma/schema.prisma`](../../prisma/schema.prisma) | `Planning.planningGroupId` opcional |
| UI resumen / generar planning | Botón y avisos |

## Relación con roadmap

Esta spec corresponde a **Fase 0** en [`roadmap-post-mvp.md`](../roadmap-post-mvp.md). Bloquea Fase D (multi-nave CEILICA).
