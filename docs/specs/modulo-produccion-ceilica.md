# Módulo de producción CEILICA — Especificación maestra

> **Estado:** planificado (post-MVP)  
> **Prototipos fuente:** [`docs/reunion/`](../reunion/README.md)

## Visión

CEILICA es el módulo de **ejecución en planta** de CoverDec. Complementa al motor de planning semanal (programación) con:

- Órdenes de producción (OP) agrupadas entre proyectos
- Confirmaciones de proceso en nave (tablet)
- Stock anticipado y cancelaciones
- Rutas multi-nave (telas, bastidores, iluminación)
- Costes plan vs real por proyecto, nave y lámpara

El planning responde a *cuándo* y *quién*; las OPs responden a *qué lote fabricar* y *cómo registrar la ejecución real*.

## Glosario

| Término | Definición |
|---------|------------|
| **SKU / Lámpara** | Producto fabricable (ej. Cruz, Selcos MC). En BD actual: `Lamp` + `ElementType`. |
| **Bastidor** | Tipo de elemento estructural con BOM y ruta (ej. MDF 30). `ElementType` con tipología `BASTIDOR`. |
| **OP** | Orden de producción: autoriza fabricar un lote concreto de unidades en un proceso o secuencia. |
| **Línea de destino** | Fila dentro de una OP: proyecto destino, unidades, RAL (si aplica). |
| **Sub-OP** | División interna de pintura por color RAL; visible solo al pintor. |
| **ORT** | Orden de retrabajo: coste y horas separados de la fabricación original. |
| **STOCK** | Destino especial sin proyecto; fabricación anticipada o devolución por cancelación. |
| **Semielaborado** | Unidad en almacén tras imprimación (sin color) o con color (RAL fijado). |
| **Tipo de ruta** | 1 = una nave; 2 = N3→N2 secuencial; 3 = naves en paralelo. |
| **Confirmación** | Cierre de un paso de ruta en OP → genera `TimeEntry` repartido por líneas. |

## Equivalencias SAP ↔ CoverDec

Fuente: `demo-ceilica-produccion.html` (vista Inicio).

| SAP | CoverDec CEILICA |
|-----|------------------|
| Maestro de material (FERT) | Lámpara / SKU |
| Lista de materiales (BOM) | Bastidor + componentes |
| Hoja de ruta + puesto | Procesos por nave (`ElementTypeProcess`) |
| Proyecto (WBS / PS) | `Project` — contenedor comercial |
| Orden de producción | `OP-{año}-{sec}-{proceso}` |
| Variante de color / lote | Sub-OP de pintura por RAL |
| Confirmación (CO11) | Imputación de horas (misma fuente que RRHH) |
| Orden de retrabajo | `ORT-{año}-{sec}` |

## Actores y permisos

| Rol | Capacidades CEILICA |
|-----|---------------------|
| **Operario** | Ver OPs asignadas (vista tablet), INICIAR / PAUSAR / CONFIRMAR proceso |
| **Jefe de producción** | Generar OPs, agrupar lotes, publicar planning, cancelar líneas, asignar stock |
| **Admin** | Catálogo de rutas, BOM, tarifas por nave, configuración |

## Integración con el modelo actual

| Entidad actual | Uso en CEILICA |
|----------------|----------------|
| `Project` | Destino comercial de líneas de OP |
| `Lamp` | Instancia de SKU en un proyecto (unidades, medidas) |
| `LampElement` | Elementos por tipología (tela, bastidor, iluminación) en distintas naves |
| `ElementType` | Catálogo SKU/bastidor; extender con tipo de ruta y BOM |
| `Task` | Tareas de planning por proceso y nave; precedencia por `lampId` + `order` |
| `Planning` / `PlanningAssignment` | Programación semanal (capa superior) |
| `ProductionOrder` | Extender: líneas, estados, agrupación (hoy es registro manual simple) |
| `TimeEntry` | Única fuente de horas reales; confirmación OP no duplica |
| `Nave` | Centro de coste y ámbito de planning (N1, N2, N3) |
| `Person` / `PersonNave` | Operarios por nave; especialidades por proceso |

## Reglas transversales

### Imputación única

La confirmación de un paso en OP crea (o actualiza) `TimeEntry`. No existe tabla paralela de horas de producción. Fuente: hint en `demo-ceilica-produccion.html` (vista Horas).

### Reparto proporcional

En OP agrupada con varias líneas de proyecto, las horas y el coste de mano de obra se reparten:

```
horas_proyecto = horas_totales × (ud_proyecto / ud_totales_OP)
```

El material se imputa por unidades de cada línea (`matCost × ud`).

### Códigos

- OP normal: `OP-2026-0042-CNC`, `OP-2026-001-PIN-CRUZ-9010`
- Stock: `OP-2026-STOCK-0051` o `STOCK-2026-009-CNC`
- Retrabajo: `ORT-2026-0007`

### Planning vs OP

| Capa | Responsabilidad |
|------|-----------------|
| Planning | Distribución semanal de `Task` por operario |
| OP | Lote de fabricación en planta, estados, confirmaciones |

Una OP puede agrupar trabajo de varios proyectos que el planning ya distribuyó de forma independiente. La generación de OPs lee necesidad pendiente de proyectos activos, no sustituye al planning.

### Coordinación multi-nave

Las lámparas con rutas que cruzan naves requieren **planning coordinado** (ver [`planning-coordinado-multinave.md`](planning-coordinado-multinave.md)). Sin ello, las precedencias inter-nave no se respetan.

## Documentos relacionados

- [Agrupación y ejecución de OP](op-agrupacion-y-ejecucion.md)
- [Stock y cancelaciones](stock-y-cancelaciones.md)
- [Rutas multi-nave](rutas-multinave.md)
- [Planning coordinado multi-nave](planning-coordinado-multinave.md)
- [Modelo de datos](modelo-datos-produccion.md)
- [Roadmap](../roadmap-post-mvp.md)

## Estado de implementación (referencia)

| Componente | Estado |
|------------|--------|
| Planning por nave + solver OR-Tools | Implementado |
| `crossNaveAssignments` (anti-solapamiento personas) | Implementado parcial |
| Planning coordinado todas las naves | Planificado (Fase 0) |
| OP agrupada con líneas | Planificado (Fase A) |
| Stock / cancelaciones | Planificado (Fase C) |
| Rutas multi-nave / N3 | Planificado (Fase D) |
| ORT / BOM / costes avanzados | Planificado (Fase E) |
