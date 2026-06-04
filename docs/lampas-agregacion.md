# Lámparas, bastidores y criterio de agregación (PR-03)

## Registro operativo (base de datos)

- Una **lámpara** (`Lamp`) pertenece a un proyecto y agrupa todo el trabajo de esa pieza.
- Cada **unidad física** de un tipo de bastidor es un `LampFrame` (p. ej. «Elemento Sol 1», «Elemento Sol 2»).
- Cada unidad genera **tareas** (`Task`) por proceso del catálogo: una fila por proceso y por unidad.

Ejemplo con «Elemento Sol» y 4 uds a 4 m²:

| Capa | Qué se guarda |
|------|----------------|
| Operativa | 4 × (CNC, Ensamblaje, Embalaje…) = 12 tareas independientes |
| Etiqueta | Sol 1 … Sol 4 (trazabilidad y partes de horas por unidad) |

**No** se fusionan en una sola tarea «CNC total» en BD: eso solo aplica a la visualización.

## Planificación y precedencia

- El motor de planning respeta el **orden de tareas dentro de la lámpara** (precedencia por lámpara).
- Las horas pendientes del proyecto en KPIs **suman todas las tareas de todas las lámparas** del proyecto.

## Visualización en la UI

| Vista | Criterio de suma |
|-------|------------------|
| Alta / edición de bastidores | Por tipo de bastidor: total = horas/ud × unidades, con desglose `/ud × N` |
| Panel de tareas — **Agrupada** | Por lámpara y tipo de bastidor: procesos iguales sumados (×N unidades) |
| Panel de tareas — **Detalle** | Una fila por tarea/unidad (datos reales de BD) |

Con **una sola unidad** y un solo bastidor no se muestra el conmutador Agrupada/Detalle: la tabla es directa.

## Edición tras el alta (metros y cantidad)

Desde el proyecto, **Bastidores** en cada lámpara permite:

- Cambiar **m²** → recalcula estimaciones según catálogo (salvo tareas con horas ya imputadas, que se ajustan con mínimo coherente).
- Aumentar **unidades** → crea nuevas unidades y tareas.
- Reducir **unidades** o quitar un tipo de bastidor → solo si esas tareas **no tienen** partes de horas ni asignaciones de planning.
- **Añadir** otro tipo de bastidor a la misma lámpara sin crear una lámpara nueva.

## Respuesta a la consulta «Sol 1 / Sol 2»

- **Registro y horas reales:** por separado (Sol 1, Sol 2…).
- **Resumen y presupuesto en pantalla:** al registrar «Elemento Sol» con 4 uds, la UI muestra **totales por proceso**; no hace falta sumar mentalmente.
- **Proyecto completo:** no hay una única suma global que sustituya a las lámparas; cada lámpara mantiene su desglose operativo.
