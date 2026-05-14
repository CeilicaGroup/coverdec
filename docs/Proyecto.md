# CONTEXTO DEL CLIENTE
CoverDec fabrica iluminación decorativa a medida para grandes superficies comerciales (Druni, Arenal, BYD, etc.) desde su nave en Silla, Valencia. El grupo tiene tres empresas que comparten nave y equipo productivo de 5 personas.

Hoy toda la operativa es manual: el planning semanal se genera a mano cada lunes, el registro de horas va a Google Sheets, y el seguimiento de producción vive en Excel. El MVP reemplaza todo eso con una plataforma web propia. El Google Sheets se corta el día 1.

## FASE 1 — Base técnica y arquitecturaDías 1–2 · Lunes–Martes
Antes de nada, conseguir todos los accesos del cliente y montar los entornos. Esta fase es bloqueante para todo lo demás.

### Accesos a conseguir el día 1:
- Credenciales del servidor propio del cliente
- Dominio o subdominio donde vivirá la plataforma
- HTML operativo actual del planning estático
- Excels definitivos (PRODUCCION_CONTRACT y FABRICA)
- Nombres exactos de las tres empresas
- Logo CONTRACT+ en alta resolución
- Contacto técnico de referencia del cliente

### Qué se construye:
- Repositorio, CI/CD y entornos staging y producción en el servidor del cliente
- Esquema de base de datos completo con multi-empresa desde el primer día (todas las tablas llevan empresa desde el inicio)
- Sistema de autenticación con tres roles: Operario, Jefe de producción y Admin
- Catálogo editable de tipos de bastidor con sus tiempos por proceso — este catálogo es el motor de todos los cálculos automáticos del planning
- Criterios de aceptación:
- Staging funcionando en el servidor del cliente
- Login operativo con selección de empresa y roles
- Catálogo de bastidores cargado con datos reales del Excel y editable desde la UI sin tocar código

## FASE 2 — Módulo de proyectos, personal y motor de planningDías 3–5 · Miércoles–Viernes
### Qué se construye:
- Gestión de proyectos y lámparas: al introducir tipo de bastidor y medida, el sistema calcula automáticamente las horas estimadas por proceso
- Perfiles del equipo productivo con especialidades, colores, responsabilidades y registro de ausencias por semana
- Motor de planning automático: dado un rango de fechas y los proyectos activos, genera la distribución de tareas respetando especialidades de cada persona, la secuencia productiva fija y las reglas de días tope críticos (imprimación máximo miércoles, pintura máximo jueves, perfiles y embalaje viernes obligatorio)
- Semáforo de riesgo por proyecto basado en fecha de entrega, horas pendientes y capacidad disponible

### Criterios de aceptación:
- El sistema calcula horas estimadas automáticamente al introducir medida y tipo de bastidor
- El motor genera un planning semanal completo respetando todas las restricciones de secuencia y días tope
- El semáforo detecta proyectos en riesgo real según capacidad disponible
- Una ausencia registrada recalcula el planning automáticamente

### Hito 1 — Validación cliente viernes semana 1 (48h)
Video o reunión mostrando: auth multi-empresa, catálogo editable, proyectos con cálculo automático de horas, planning generado automáticamente, semáforo de riesgo. El cliente valida antes del lunes siguiente.

## FASE 3 — Planning visual, registro de horas y fábricaDías 6–8 · Lunes–Miércoles semana 2
Con el feedback del hito 1 incorporado.
### Qué se construye:
- Vista planning semanal replicando la UX del HTML existente del cliente: por persona, por proyecto, Gantt, disponibilidad. Colores corporativos por proceso idénticos al HTML de referencia. El jefe puede ajustar manualmente la propuesta del motor antes de publicarla
- Registro de horas en plataforma propia sustituyendo el Google Sheets desde el día 1: timer en vivo o entrada manual, vinculado a proyecto/lámpara/proceso, datos directo a BD
- Dashboard de horas reales vs planificadas en tiempo real: lo que hoy está en el Excel (horas plan, reales, extras, desviación, % avance) visible sin intervención manual
- Módulo de fábrica replicando el Excel FABRICA: estados de producción por producto (Dossier → Enviado), nave, fecha, comentarios, código. Actualizable desde cualquier dispositivo
- Órdenes de producción imprimibles desde el planning: siempre con Coverdec Innovación SL y logo CONTRACT+ juntos, nunca uno sin el otro
- Migración de datos históricos de ambos Excels a la BD

### Criterios de aceptación:
- Un operario registra horas desde nave en móvil o tablet y aparecen en el dashboard del jefe en tiempo real
- El planning visual es funcionalmente equivalente al HTML de referencia del cliente
- Los datos históricos del Excel están migrados y el dashboard los refleja correctamente
- Las órdenes de producción se imprimen con la identidad visual correcta

## FASE 4 — Testing, despliegue y entregaDías 9–10 · Jueves–Viernes semana 2
### Qué se construye:
- Testing de flujo completo en dispositivos reales (móvil y tablet para operarios en nave, desktop para jefe de producción)
- Despliegue en producción en el servidor del cliente con backup automático de BD
- Documentación técnica básica: arquitectura, módulos, guía de despliegue, guía de uso para jefe y para operario
- Entrega de propiedad: repositorio completo, esquema de BD, credenciales de todos los servicios

### Criterios de aceptación:
- La plataforma está en producción y el equipo accede con sus credenciales
- El jefe de producción genera el planning de la semana sin ayuda
- Los operarios registran horas desde nave sin incidencias
- El cliente tiene todos los accesos para operar o transferir el sistema de forma independiente

### Hito final — Entrega y validación viernes semana 2
Reunión con Ana, Oleh y John. Demo en vivo del sistema completo. Entrega de accesos, repositorio y documentación.

## ACCESOS A PEDIR EN EL KICK-OFF
- Servidor del cliente: credenciales para despliegue [PENDIENTE]
- Dominio o subdominio [PENDIENTE]
- HTML operativo actual del planning [Planning](planning_S19_2026.html)
- Excels definitivos de producción y fábrica [Produccion](PRODUCCION.xlsx)
- Nombres exactos de las tres empresas [PENDIENTE]
- Prompt maestro que usaban en Claude [PromptMaestro](PromptMaestro.html)

## MEJORAS IDENTIFICADAS — FUERA DEL MVP
Para fases siguientes, presupuestadas y aprobadas de forma independiente:
- Alertas automáticas cada lunes: notificación vía WhatsApp o email al jefe de producción con el estado de riesgo semanal de todos los proyectos. Estimación: 1 día de trabajo.
- Planning asistido por IA: en lugar de solo el algoritmo determinista, un asistente que razona sobre imprevistos (una persona enferma, un material que llega tarde, un proyecto que se adelanta) y propone redistribuciones explicadas. Esto es exactamente lo que hace Claude hoy manualmente cada lunes, pero integrado en la plataforma con acceso directo a los datos reales.
- Módulo CRM: clientes, contactos, oportunidades y pipeline comercial multi-empresa.
- Módulo de soporte interno: incidencias y solicitudes entre equipos.
- Reporting avanzado: dashboards de negocio, rentabilidad por proyecto, productividad por persona, exportación e informes periódicos automáticos.
