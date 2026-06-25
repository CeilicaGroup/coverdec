# Documentos de reunión — Módulo CEILICA

Prototipos HTML interactivos acordados con el cliente para definir el **módulo de producción CEILICA** (post-MVP). No son código de producción: son referencias de UX, reglas de negocio y flujos objetivo.

## Cómo abrirlos

Abre cualquier `.html` en el navegador (doble clic o arrastrar al navegador). No requieren servidor.

```bash
xdg-open docs/reunion/demo-ceilica-produccion.html
```

## Orden de lectura recomendado

1. [`demo-sap-produccion.html`](demo-sap-produccion.html) — Marco conceptual SAP PP (maestros → MRP → orden → confirmación → coste).
2. [`demo-ceilica-produccion.html`](demo-ceilica-produccion.html) — Equivalencias SAP↔CoverDec, agrupación de OP entre proyectos, sub-OP por RAL, ORT.
3. [`contract_plus_ops.html`](contract_plus_ops.html) — UX operativa: listado, calendario, tablet operario, generador de OPs.
4. [`demo-ceilica-produccion-v2.html`](demo-ceilica-produccion-v2.html) — Stock anticipado, cancelaciones, almacén.
5. [`demo-ceilica-multinave-v3.html`](demo-ceilica-multinave-v3.html) — Tres naves, tipos de ruta, OP secuencial N3→N2.

## Índice de prototipos

| Archivo | Título | Qué define |
|---------|--------|------------|
| `demo-sap-produccion.html` | SAP · Gestión de producción (PP) | Referencia externa: BOM, hoja de ruta, estados de orden, confirmaciones CO11, coste plan vs real |
| `demo-ceilica-produccion.html` | CEILICA · Módulo M01 | Cadena de producción CoverDec, agrupación CNC por bastidor, reparto de horas por proyecto, retrabajos ORT |
| `contract_plus_ops.html` | CONTRACT+ · Órdenes de Producción | Pantallas del jefe y operario: KPIs, filtros, calendario L–V, vista tablet, generación de OPs agrupadas |
| `demo-ceilica-produccion-v2.html` | CEILICA · Stock y cancelaciones | OP con líneas de destino, fabricación a stock (para en imprimación), asignación posterior, reglas de cancelación |
| `demo-ceilica-multinave-v3.html` | CEILICA · Producción multi-nave | N1 Telas, N2 Bastidores, N3 Iluminación; tipos de ruta 1/2/3; costes por centro de coste |

## Documentación derivada

Las specs técnicas y el roadmap de implementación están en:

- [`../specs/modulo-produccion-ceilica.md`](../specs/modulo-produccion-ceilica.md) — Visión y glosario del módulo
- [`../specs/op-agrupacion-y-ejecucion.md`](../specs/op-agrupacion-y-ejecucion.md) — Agrupación, estados y UX de OPs
- [`../specs/stock-y-cancelaciones.md`](../specs/stock-y-cancelaciones.md) — Stock anticipado y cancelaciones
- [`../specs/rutas-multinave.md`](../specs/rutas-multinave.md) — Rutas por lámpara y tres naves
- [`../specs/planning-coordinado-multinave.md`](../specs/planning-coordinado-multinave.md) — Planning conjunto de todas las naves
- [`../specs/modelo-datos-produccion.md`](../specs/modelo-datos-produccion.md) — Esquema de datos propuesto
- [`../roadmap-post-mvp.md`](../roadmap-post-mvp.md) — Fases de implementación

## Relación con el MVP actual

El MVP ([`../Proyecto.md`](../Proyecto.md)) cubre planning semanal, registro de horas, fábrica y OPs imprimibles básicas. Los prototipos de esta carpeta definen la **siguiente evolución**: ejecución en planta con OPs agrupadas, stock, multi-nave CEILICA y costes trazados.
