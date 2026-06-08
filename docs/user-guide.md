# Guía de uso rápida

## Acceso

1. Abre la URL de la aplicación.
2. Inicia sesión (el administrador inicial se crea con `npm run db:seed` en desarrollo).
3. Si tienes varias empresas asignadas, elige la activa desde el menú de usuario (esquina inferior del sidebar).

## Roles

- **Operario**: en **Por persona** solo ve su ficha si está vinculado a `Person`; registro de horas (timer o manual); lectura del resto del planning según permisos.
- **Jefe de producción**: todo lo anterior más generar/publicar planning, costes, fábrica, órdenes de producción, proyectos y catálogo.
- **Admin**: igual que jefe; pensado para configuración y soporte.

## Flujo semanal típico (jefe)

1. **Resumen**: elige semana con las flechas del calendario.
2. Pulsa **Generar planning** (borrador). En **Alcance** puedes elegir: esta semana, 1 mes (4 semanas), hasta acabar todos los proyectos, hasta acabar un proyecto concreto, o hasta una fecha. Revisa avisos de tareas no asignadas.
3. Revisa **Vista semana** o **Vista mes** (calendario mensual con resumen por día; pulsa un día para abrir la semana), **Por persona**, **Por proyecto** y **Disponibilidad**.
4. **Publicar** cuando el borrador sea válido.
5. En **Por persona**, pulsa **Imprimir** para reparto en nave (ausencias y fichas por operario).

## Registro de horas (operario)

1. **Mis horas**.
2. **Timer**: proyecto (y opcionalmente lámpara/proceso) → Iniciar → Parar.
3. **Manual**: fecha/hora inicio, horas, proyecto.

## Personal y especialidades

En **Personal** cada operario tiene procesos clasificados en dos niveles:

| Nivel | Uso habitual | Impacto en el planning |
| --- | --- | --- |
| **Responsable** | Rol principal del proceso (p. ej. pintura, CNC). | El motor asigna primero a los responsables. |
| **Apoyo / sustituto** | Puede cubrir el proceso cuando el responsable no está (ausencia, saturación) o tiene competencia secundaria. | Candidato secundario: recibe trabajo si hace falta cubrir huecos. |

**Tiempos:** ninguna categoría modifica las horas estimadas de las tareas (vienen del catálogo y del bastidor). Solo influyen en **quién** puede ser asignado y en **qué orden de preferencia**.

## Fábrica

Lista importada desde Excel; cambia **Estado** con el desplegable (requiere rol jefe/admin).

## Órdenes de producción

**Nueva OP** rellena proyecto y datos; **Imprimir** abre hoja con marca CONTRACT+ y Coverdec Innovación SL.

## Importación Excel (técnicos)

```bash
npx tsx scripts/import-excels.ts
```

Idempotente: vuelve a ejecutar tras cambios en los xlsx si hace falta sincronizar (ajustar empresa en el script si aplica).
