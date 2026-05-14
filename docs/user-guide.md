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
2. Pulsa **Generar planning** (borrador). Revisa avisos de tareas no asignadas.
3. Revisa **Vista semana**, **Por persona**, **Por proyecto** y **Disponibilidad**.
4. **Publicar** cuando el borrador sea válido.
5. En **Por persona**, pulsa **Imprimir** para reparto en nave (ausencias y fichas por operario).

## Registro de horas (operario)

1. **Mis horas**.
2. **Timer**: proyecto (y opcionalmente lámpara/proceso) → Iniciar → Parar.
3. **Manual**: fecha/hora inicio, horas, proyecto.

## Fábrica

Lista importada desde Excel; cambia **Estado** con el desplegable (requiere rol jefe/admin).

## Órdenes de producción

**Nueva OP** rellena proyecto y datos; **Imprimir** abre hoja con marca CONTRACT+ y Coverdec Innovación SL.

## Importación Excel (técnicos)

```bash
npx tsx scripts/import-excels.ts
```

Idempotente: vuelve a ejecutar tras cambios en los xlsx si hace falta sincronizar (ajustar empresa en el script si aplica).
