# Rutas multi-nave CEILICA

> **Prototipo:** [`demo-ceilica-multinave-v3.html`](../reunion/demo-ceilica-multinave-v3.html)

## Contexto

CoverDec opera en **tres centros de coste** (naves). Cada lámpara activa 1, 2 o 3 naves según su ruta de fabricación.

| Nave | Código | Actividad | Comportamiento |
|------|--------|-----------|----------------|
| Nave 1 | N1 | Telas | Siempre en **paralelo** con el resto |
| Nave 2 | N2 | Bastidores | CNC, imprimación, pintura, embalaje bastidor |
| Nave 3 | N3 | Iluminación | LED, cableado, pruebas |

**Secuencia especial N3→N2:** en lámparas Canopi, Sol y Selcos metacrilato, el mismo objeto físico pasa de iluminación a cierre de bastidor en una **OP compartida** (fases N3 luego N2).

## Tipos de ruta

| Tipo | Naves | OPs generadas | Ejemplo |
|------|-------|---------------|---------|
| **1 — Simple** | Una sola | 1 OP en esa nave | (reservado; entrega directa) |
| **2 — N3→N2 secuencial** | N1 paralela + SEQ | 1 OP N1 + 1 OP N3→N2 | Selcos MC, Canopi, Sol |
| **3 — Paralelo** | 1, 2 o 3 en paralelo | 1 OP por nave activa | Cruz (N1+N2+N3), Luminaria (N1+N3) |

### Matriz de catálogo (demo)

| Lámpara | SKU | N1 | N2 | N3 | Tipo |
|---------|-----|----|----|-----|------|
| Cruz | LAMP-CRUZ | ✓ | ✓ | ✓ | 3 paralelo |
| Selcos MC | LAMP-SELCOS | ✓ | SEQ | SEQ | 2 secuencial |
| Canopi | LAMP-CANOPI | ✓ | SEQ | SEQ | 2 secuencial |
| Sol | LAMP-SOL | ✓ | SEQ | SEQ | 2 secuencial |
| Hair | LAMP-HAIR | ✓ | ✓ | ✓ | 3 paralelo |
| Parafarmacia | LAMP-PHAR | ✓ | ✓ | ✓ | 3 paralelo |
| Luminaria | LAMP-LUM | ✓ | — | ✓ | 3 (sin bastidor) |

## Procesos y tiempos por nave

Cada nave/fase tiene procesos con `setup` (min) y `tpu` (min/unidad):

**N1 — Telas**
- Corte tela (15 + 8/ud)
- Costura/acabado (5 + 12/ud)

**N2 — Bastidores**
- CNC bastidor (25 + 9/ud)
- Imprimación (15 + 6/ud)
- Pintura RAL (20 + 10/ud)

**N3 — Iluminación**
- Instalación LED (10 + 14/ud)
- Cableado/prueba (8 + 10/ud)

**SEQ (N3→N2)** — procesos encadenados en una OP:
1. Inst. iluminación (N3)
2. Cableado/prueba (N3)
3. Cierre bastidor (N2) ← *traspaso físico*
4. Perfil tela (N2)
5. Ensamblaje final (N2)
6. Embalaje (N2)

Al confirmar paso 2→3, el sistema registra: `TRASPASO físico Nave 3 → Nave 2`.

## Generación de OPs desde proyecto

Ejemplo proyecto P-6-075 (Hospital Universitario Valencia):

| SKU | Ud | RAL | OPs que genera |
|-----|-----|-----|----------------|
| Cruz | 5 | 9005 | 3 OPs paralelas (N1, N2, N3) |
| Selcos MC | 5 | 9010 | 1 OP N1 + 1 OP N3→N2 |
| Luminaria | 2 | 6018 | 2 OPs paralelas (N1, N3) |

Acción **Crear todas las OPs** → 6 OPs en total para el proyecto.

## Imputación de horas

- Cada confirmación imputa al **centro de coste de la nave** que ejecuta el paso.
- En OP SEQ, fases N3 imputan a N3; fases N2 imputan a N2.
- Tarifas demo: N1 = 28 €/h, N2 = 52 €/h, N3 = 38 €/h.

## Costes por nave y proyecto

Desglose por SKU × nave × tipo:

- **Plan €**: calculado con `planMin(nave, ud)` y tarifa
- **Real €**: acumulado de confirmaciones
- **Desv.**: real − plan

OP compartida SEQ: coste dividido entre N3 y N2 según fases ejecutadas.

Material: reparto proporcional si la lámpara usa varias naves (`matU × ud`).

## Gap con implementación actual

| Aspecto | Hoy | Objetivo |
|---------|-----|----------|
| Naves en seed | N1, N2 | Añadir **N3** |
| Tipología → nave | TELA→N1, BASTIDOR→N1, ILUMINACION→N2 | TELA→N1, BASTIDOR→N2, ILUMINACION→N3 |
| Tipo de ruta en catálogo | No existe | Campo en `ElementType` o `LampSku` |
| OP secuencial | No | `naveKey: SEQ` con fases multi-nave |
| Planning | Por nave aislada | **Planning coordinado** (prerequisito) |

Ver [`planning-coordinado-multinave.md`](planning-coordinado-multinave.md).

## Migración propuesta (datos)

1. Crear nave `N3` — «Nave 3 · Iluminación».
2. Actualizar `ElementTypologyNave`: `BASTIDOR` → N2.
3. Añadir `routeType` (1|2|3) y `activeNaves` en catálogo de lámparas.
4. Para lámparas tipo 2, marcar secuencia N3→N2 en definición de ruta.

## Criterios de aceptación

- [ ] Catálogo muestra matriz lámpara × nave × tipo de ruta
- [ ] Proyecto con 3 SKUs distintos genera el número correcto de OPs
- [ ] OP SEQ registra traspaso N3→N2 al confirmar fase de cierre
- [ ] Costes desglosados por nave coinciden con suma de confirmaciones
- [ ] Planning coordinado respeta que N2 SEQ no empiece antes de fin N3

## Impacto en código (referencia)

- `prisma/seed.ts`: N3 y tipologías
- Extender `ElementType` con `routeType`, `routeNaves`
- `features/production-orders/create-from-project.ts`
- Paneles home KPI por nave (como demo v3)
