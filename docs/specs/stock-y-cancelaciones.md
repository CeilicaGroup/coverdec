# Stock anticipado y cancelaciones

> **Prototipo:** [`demo-ceilica-produccion-v2.html`](../reunion/demo-ceilica-produccion-v2.html)

## Objetivo

Gestionar fabricación **sin proyecto asignado** (stock anticipado), reasignación cuando llega un pedido, y **cancelaciones** de proyectos o unidades con reglas distintas según el proceso alcanzado.

## OP de stock anticipado

### Creación

- Destino de todas las líneas: `STOCK` (sin `projectId`)
- Sin RAL (el color se define al asignar a proyecto)
- Ejemplo: `OP-2026-STOCK-0051` · 8× Cruz · bastidor MDF 30

### Flujo de procesos

Misma ruta que OP normal: CNC → Ensamblaje → Imprimación → Pintura.

| Paso | Comportamiento |
|------|----------------|
| PEND | Botón INICIAR |
| EN CURSO | CONFIRMAR por proceso; horas al colector STOCK |
| Tras **imprimación** | OP pasa a estado **IMPRIMADO**; pintura **bloqueada** (sin RAL) |
| Almacén | Se crea registro semielaborado |

### Parada post-imprimación

Tras confirmar imprimación:

```
estado_OP = IMPRIMADO
almacén += { lámpara: Cruz, bastidor: MDF 30, estado: Imprimado, ud: N, minAcum: Σ min/ud procesos 0..2 }
```

La pintura queda bloqueada hasta que un proyecto reclame las unidades con RAL conocido.

## Asignación desde stock a proyecto

Cuando llega un proyecto que necesita unidades ya imprimadas:

**Ejemplo:** P-2026-030 necesita 5× Cruz RAL 6018; hay 8 ud imprimadas en almacén.

1. Seleccionar unidades a asignar (≤ disponibles).
2. **Trasladar horas** acumuladas de STOCK al proyecto: `minOrig = minAcum × ud_asignadas`.
3. **Añadir horas de pintura** nuevas: `minPint = min_pintura/ud × ud_asignadas`.
4. Crear registro en almacén «Terminado (proyecto)» o cerrar línea de stock.

```
log: Asignación → P-2026-030 · trasladadas X h desde STOCK + Y h de pintura (RAL 6018)
```

## Modelo de almacén

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `lamp` | string | SKU / nombre lámpara |
| `bastidor` | string | Tipo bastidor |
| `estado` | enum | `Imprimado` \| `Stock con color` \| `Terminado (proyecto)` |
| `ral` | string? | Solo si ya pintado |
| `hex` | string? | Muestra visual |
| `ud` | int | Unidades disponibles |
| `minAcum` | number | Minutos/ud acumulados hasta el estado actual |

## Cancelaciones

Fuente: vista Cancelaciones en `demo-ceilica-produccion-v2.html`.

### Regla según proceso alcanzado

| Situación | Destino de unidades canceladas |
|-----------|-------------------------------|
| **Antes de fabricar** (step = 0) | Reducir línea OP; **sin coste** |
| **En proceso, sin pintura** | Almacén **Imprimado** (reasignable a cualquier RAL) |
| **Ya pintado** (step ≥ pintura o OP cerrada) | Almacén **Stock con color** (solo mismo RAL) |

### Cancelación de proyecto completo

Ejemplo: cancelar P-2026-021 (4 ud) de OP-2026-0042:

1. Calcular `minDone = Σ min/ud` de procesos completados.
2. `transferMin = minDone × ud_canceladas`.
3. Mover a almacén con estado según tabla anterior.
4. Marcar línea como `CANCELADO` (ud → 0).
5. Registrar en log de horas: horas y € trasladados de proyecto a STOCK.

### Cancelación parcial de unidades

Ejemplo: cancelar 2 ud de P-2026-018 (quedan 4):

- Si step = 0: solo reduce `ud` en la línea.
- Si step > 0: 2 ud van a almacén con reglas de estado.

### Mensaje UI

> Las unidades ya están pintadas con su RAL: al cancelar pasan a «stock con color», reutilizables solo si aparece un proyecto con ese mismo RAL.

> Las unidades aún no tienen color: al cancelar vuelven a stock imprimado, reasignables a cualquier proyecto.

## Costes por destino

Vista Costes en v2: agrega por clave de destino (proyecto, STOCK, cancelado).

```
coste = (min/60) × tarifa_hora + material × ud
```

Las horas de STOCK se acumulan en colector hasta asignación o cancelación.

## Integración con OP agrupada

Las líneas de una OP pueden mezclar destinos:

| destino | Significado |
|---------|-------------|
| `P-2026-018` | Proyecto activo |
| `STOCK` | Fabricación anticipada |
| `CANCELADO` | Línea anulada (ud = 0) |

En pintura, solo líneas con `ral` definido entran en el cálculo de unidades.

## Criterios de aceptación

### Stock

- [ ] Crear OP stock sin proyecto; confirmar hasta imprimación → estado IMPRIMADO y entrada en almacén
- [ ] Pintura bloqueada en OP stock sin RAL
- [ ] Asignar N ud a proyecto traslada horas STOCK + genera horas pintura

### Cancelaciones

- [ ] Cancelar proyecto antes de CNC: reduce OP sin movimiento almacén
- [ ] Cancelar tras imprimación: ud en almacén Imprimado
- [ ] Cancelar tras pintura: ud en almacén con color, filtro por RAL en reasignación

### Almacén

- [ ] Panel muestra existencias por lámpara, bastidor, estado, RAL, ud
- [ ] Log de horas refleja traslados proyecto ↔ STOCK con importe €

## Impacto en código (referencia)

- Nuevo modelo `StockItem` (ver [`modelo-datos-produccion.md`](modelo-datos-produccion.md))
- `ProductionOrder.kind`: `PROYECTO` | `STOCK` | `ORT`
- Server actions: `assignStockToProject`, `cancelOrderLine`
- UI: vistas Stock, Cancelaciones, Almacén (como en demo v2)
