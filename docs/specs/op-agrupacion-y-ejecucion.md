# OP — Agrupación y ejecución en planta

> **Prototipos:** [`demo-ceilica-produccion.html`](../reunion/demo-ceilica-produccion.html), [`contract_plus_ops.html`](../reunion/contract_plus_ops.html)

## Objetivo

Pasar de OPs manuales (un proyecto, un proceso) a **órdenes agrupadas** que reflejan cómo se fabrica en nave: mismos programas CNC, lotes de imprimación, sub-OPs de pintura por color.

## Criterios de agrupación por proceso

Fuente: hoja de ruta en `demo-ceilica-produccion.html` (vista Maestros).

| Proceso | Criterio de agrupación | División | Notas |
|---------|------------------------|----------|-------|
| **CNC** | Mismo bastidor / material, mismo programa Aspire | Por material (MDF 30, metacrilato…) | Ej.: Cruz + Parafarmacia en una OP si comparten MDF 30 |
| **Ensamblaje** | Por tipo de lámpara | Una OP por lámpara | |
| **Imprimación** | Lote completo | **Nunca se divide** entre proyectos | Base blanca universal |
| **Pintura** | Sub-OP por RAL | Una sub-OP por color | Visible solo al pintor |
| **Lijado** | Por tipo de lámpara o lote | Según semana | |
| **Embalaje** | Por tipo o combinación compatible | Flexible | Ej.: Cruz + Canopi juntos |
| **Retrabajo (ORT)** | Independiente | Siempre OP separada | Coste trazado aparte |

### Ejemplo CNC agrupado

Dos proyectos piden lámpara Cruz con bastidor MDF 30:

- P-2026-018: 6 ud, RAL 9005
- P-2026-021: 4 ud, RAL 9010

El sistema sugiere **una OP de 10 ud** para CNC. Decisión final: jefe de producción u operario CNC.

## Estructura de una OP agrupada

```
ProductionOrder
├── id: OP-2026-0042-CNC
├── lampSku: Cruz
├── bastidor: MDF 30
├── proceso: CNC
├── estado: PEND | CURSO | INT | MULTI | CERR
├── step: índice de proceso confirmado en la ruta
└── líneas:
    ├── { destino: P-2026-018, ud: 6, ral: 9005 }
    └── { destino: P-2026-021, ud: 4, ral: 9010 }
```

Al llegar a **pintura** (step ≥ 3), se generan sub-OPs visibles al pintor:

- `OP-2026-0042-PIN-CRUZ-RAL9005` · 6 ud
- `OP-2026-0042-PIN-CRUZ-RAL9010` · 4 ud

## Estados y acciones

Fuente: `demo-ceilica-produccion.html` (vista OP), `contract_plus_ops.html`.

| Estado | Significado | Acciones disponibles |
|--------|-------------|----------------------|
| **Pendiente** | Creada, no iniciada | INICIAR |
| **En curso** | Proceso activo | CONFIRMAR paso, PAUSAR |
| **Interrumpida** | Pausada con causa | REANUDAR |
| **Multiday** | Sigue otro día (ud parciales) | CONFIRMAR / continuar |
| **Cerrada** | Finalizada | Solo lectura; horas imputadas |

### Flujo de confirmación

1. **INICIAR** — pasa a En curso, arranca primer proceso de la ruta.
2. **CONFIRMAR {proceso}** — suma minutos reales (`prep + min/ud × ud`), avanza `step`.
   - En pintura: solo cuenta unidades de líneas **con RAL**.
3. **PAUSAR** — Interrumpida (causa obligatoria en producción real).
4. **FINALIZAR** — Cierra OP, reparte horas a proyectos, imputa material.

## Generación de OPs

Fuente: `contract_plus_ops.html` (pestaña Generar OPs).

### Entrada

- Proyectos activos con lámparas pendientes
- Catálogo de bastidores y reglas de agrupación
- Planning publicado de la semana (opcional, para fechas)

### Proceso

1. Calcular **necesidad** por lámpara/bastidor/proceso.
2. **Sugerir agrupaciones** (ej. bloque MDF 30 con checkboxes por proyecto).
3. Jefe selecciona y pulsa **Generar OPs seleccionadas**.
4. Sistema crea N OPs con líneas de destino.

### Salida ejemplo (semana S24)

18 OPs para 3 proyectos activos: CNC agrupados, imprimación en lote, sub-OPs pintura por RAL, embalajes por tipo.

## Vistas UX

### Listado (`contract_plus_ops.html` — tab Listado)

- KPIs: OPs semana, horas estimadas, en curso, desviación media
- Filtros por proceso y estado
- Tabla: código, proceso, lámpara/lote, uds, est/real, desvío %, operario, proyectos, estado
- Clic en fila → drawer de detalle

### Calendario (tab Calendario)

- Eje L–V, franjas horarias 7:00–19:00
- Bloques por OP con color de proceso
- OPs multiday ocupan varios días

### Vista tablet operario (tab Vista operario)

- Una tarjeta por operario activo
- OPs del día con botón INICIAR / REANUDAR
- Lo que ve cada persona en dispositivo de planta

### Drawer de detalle

- Código OP, proceso, estado, notas (ej. «Graba código 001-1…001-15 en Aspire»)
- Píldoras de proyectos con unidades
- Imputación: plan vs real vs desvío
- Acciones según estado

## Reparto de horas y costes

Al **FINALIZAR** OP agrupada (`demo-ceilica-produccion.html`):

```
Para cada línea de proyecto P con ud_P:
  horas_P = (realMin/60) × (ud_P / ud_total)
  coste_P = horas_P × tarifa + matCost × ud_P
```

Coste plan por proyecto: `(matCost + Σ min/ud × tarifa) × ud`.

## Criterios de aceptación

### Generación

- [ ] Dos proyectos con misma lámpara/bastidor generan sugerencia de OP agrupada CNC
- [ ] Imprimación nunca genera más de un lote por material/semana cuando hay mezcla de proyectos
- [ ] Pintura genera sub-OPs separadas por RAL

### Ejecución

- [ ] INICIAR → CONFIRMAR × N → FINALIZAR produce `TimeEntry` por proyecto proporcional a ud
- [ ] PAUSAR / REANUDAR conserva step y no duplica horas
- [ ] OP multiday muestra progreso parcial (ej. 9/12 uds)

### UX

- [ ] Listado filtra por proceso y estado
- [ ] Calendario muestra OPs en franja horaria correcta
- [ ] Vista tablet muestra solo OPs del operario logueado
- [ ] Drawer muestra desglose por proyecto y desvío %

## Impacto en código (referencia)

- Extender [`ProductionOrder`](../../prisma/schema.prisma) y crear `ProductionOrderLine`
- Nuevo servicio `features/production-orders/grouping.ts`
- UI: sustituir/ampliar [`src/app/(dashboard)/dashboard/ordenes/`](../../src/app/(dashboard)/dashboard/ordenes/)
- Confirmación OP → server action que crea `TimeEntry` repartidos
