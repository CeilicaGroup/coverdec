import { Role } from "@/generated/prisma";

export interface HelpLink {
  href: string;
  label: string;
}

export interface HelpSection {
  id: string;
  title: string;
  roles: Role[];
  paragraphs: string[];
  steps?: string[];
  bullets?: string[];
  links?: HelpLink[];
}

export interface HelpFaqItem {
  id: string;
  question: string;
  answer: string;
  roles: Role[];
}

export interface HelpRoleMeta {
  role: Role;
  label: string;
  intro: string;
}

export interface HelpForRole {
  meta: HelpRoleMeta;
  sections: HelpSection[];
  faq: HelpFaqItem[];
}

const ALL: Role[] = [Role.OPERARIO, Role.JEFE_PRODUCCION, Role.ADMIN];
const JEFE_ADMIN: Role[] = [Role.JEFE_PRODUCCION, Role.ADMIN];
const ADMIN_ONLY: Role[] = [Role.ADMIN];
const OPERARIO_ONLY: Role[] = [Role.OPERARIO];

export const HELP_ROLE_META: Record<Role, HelpRoleMeta> = {
  [Role.OPERARIO]: {
    role: Role.OPERARIO,
    label: "Operario",
    intro:
      "Esta guía detalla todo lo que puedes hacer con tu rol: fichar jornada, registrar horas (timer y manual), leer el planning publicado y gestionar notificaciones. No verás pantallas de generación de planning, catálogo ni administración.",
  },
  [Role.JEFE_PRODUCCION]: {
    role: Role.JEFE_PRODUCCION,
    label: "Jefe de producción",
    intro:
      "Esta guía explica el ciclo completo de planning (generar, revisar, publicar), proyectos, personal, catálogo, stock, costes y la operativa diaria. No incluye la configuración de usuarios y naves reservada al administrador.",
  },
  [Role.ADMIN]: {
    role: Role.ADMIN,
    label: "Administrador",
    intro:
      "Esta guía incluye todo lo del jefe de producción más la configuración del sistema: naves, usuarios, canales de alerta, trazabilidad, órdenes de trabajo e importación/exportación.",
  },
};

const SECTIONS: HelpSection[] = [
  {
    id: "inicio-rapido",
    title: "Inicio rápido",
    roles: ALL,
    paragraphs: [
      "CONTRACT+ es la plataforma de Coverdec Innovación SL para planificar la producción por nave, registrar horas y seguir proyectos y lámparas. Sustituye el planning manual, las hojas de horas y el Excel de seguimiento.",
      "La navegación superior se agrupa en Planning, Operativa, Catálogo y Admin. Lo que ves en cada grupo depende de tu rol.",
    ],
    steps: [
      "Abre la URL de la aplicación e inicia sesión en Iniciar sesión con Email y Contraseña (mínimo 8 caracteres). Pulsa Entrar.",
      "Si las credenciales no son válidas verás el aviso Credenciales inválidas.",
      "Administrador: tras el login vas a Selecciona tu nave. Elige la card de la nave (nombre y código) y pulsa Entrar. Si no hay naves, verás que no hay naves configuradas.",
      "Aterrizaje habitual: Operario → Mis horas; Jefe y Admin → Resumen del planning.",
    ],
    links: [
      { href: "/dashboard/horas", label: "Mis horas" },
      { href: "/dashboard", label: "Resumen" },
    ],
  },
  {
    id: "navegacion-roles",
    title: "Navegación y roles",
    roles: ALL,
    paragraphs: [
      "Hay tres roles. El menú y esta ayuda se adaptan automáticamente.",
    ],
    bullets: [
      "Operario: Operativa (Fichaje diario, Mis horas, Notificaciones, Ayuda) y Planning limitado (Vista semana, Por persona, Por proyecto). No ve Resumen, mes, Gantt, disponibilidad, desviaciones, Catálogo ni Admin.",
      "Jefe de producción: Planning completo, Operativa, Catálogo (Proyectos, Stock, Elementos, Personal) y Costes. No ve la sección Admin (naves, usuarios, trazabilidad, OT admin, importar/exportar).",
      "Administrador: igual que el jefe más toda la sección Admin. No tiene Mis horas en el menú (el registro diario lo hacen los operarios).",
    ],
  },
  {
    id: "que-puedes-hacer",
    title: "Qué puedes hacer tú",
    roles: OPERARIO_ONLY,
    paragraphs: [
      "Tu día a día suele ser: fichar jornada, trabajar las tareas de la cola en Mis horas y consultar el planning publicado si necesitas contexto.",
    ],
    bullets: [
      "Fichaje diario: iniciar/finalizar jornada y descansos, o registrar franjas manuales.",
      "Mis horas: timer (Iniciar / Parar), Completar 1 o Completar varias, Registro manual e imprevistas asignadas.",
      "Planning: ver Vista semana, Por persona (tu ficha si estás vinculado) y Por proyecto. Solo ves planning publicado, no borradores.",
      "Notificaciones: avisos de la plataforma; puedes marcar leídas/no leídas.",
      "No puedes generar ni publicar planning, ni editar proyectos, catálogo, personal, stock ni costes.",
    ],
    links: [
      { href: "/dashboard/horas", label: "Mis horas" },
      { href: "/dashboard/fichaje-diario", label: "Fichaje diario" },
      { href: "/dashboard/semana", label: "Vista semana" },
    ],
  },
  {
    id: "naves",
    title: "Naves y ámbito del planning",
    roles: JEFE_ADMIN,
    paragraphs: [
      "El planning y gran parte de la operativa están acotados a una nave. En las secciones de Planning (y datos que dependen de ella) verás el selector de nave en la cabecera.",
    ],
    bullets: [
      "Jefe: el selector lista solo las naves; siempre trabajas sobre una nave concreta para consultar datos.",
      "Admin: además puedes elegir Todas (sin filtro). Con Todas ves datos de todas las naves activas.",
      "Generar, Publicar y Deshacer requieren no tener una nave filtrada: quedan deshabilitados con el aviso El planning se genera, publica y deshace para todas las naves. Quita el filtro de nave. En Admin, pon el selector en Todas para habilitarlos.",
      "Admin elige nave tras el login en Selecciona tu nave; después puede cambiarla con el selector (incluida Todas).",
      "Cambiar de nave refresca Resumen, Semana, Mes, Persona, Proyecto, Gantt, Disponibilidad, Desviaciones y Costes.",
    ],
  },
  {
    id: "resumen",
    title: "Resumen: generar y publicar",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Resumen es el centro de mando del planning semanal. El título muestra la semana (S{n} · año). Usa las flechas o el selector de WeekNav para cambiar de semana (las marcas indican si hay planning o registros).",
      "Generar crea un borrador. Publicar lo hace definitivo para la nave/equipo. Admin puede ver borradores con el toggle Solo publicado | + borrador en la cabecera de Planning; jefe y operario solo ven planning publicado (un borrador les aparece como sin planning).",
    ],
    steps: [
      "Elige la semana en WeekNav. Si eres Admin, pon el selector de nave en Todas para poder generar/publicar (con una nave filtrada esos botones quedan deshabilitados).",
      "Opcional — Estrategia (ajustes globales): Refuerzo global de entrega (0–100%), Curva no lineal / proximidad (1.0–4.0), Multiplicador fuera de fecha (1.0–8.0x). Pulsa Guardar → Ajustes globales guardados.",
      "Alcance: Esta semana | 1 mes (4 semanas) | Hasta acabar todos | Hasta acabar proyecto… (elige proyecto con horas pendientes) | Hasta fecha… (date picker).",
      "Planificar desde: día laborable (lun–vie) de la semana. Solo se asignará trabajo desde ese día en adelante dentro de la semana. Por defecto suele ser hoy si cae en la semana; si no, el lunes.",
      "Pulsa Generar planning (o Regenerar). Arranca un job en segundo plano (toast Generación de planning iniciada; banner Generando planning…). Puedes seguir navegando.",
      "Al terminar puede abrirse Avisos del planning (horas que no caben, lista de incidencias). Revísalos.",
      "Revisa las vistas (semana, mes, persona, proyecto, Gantt, disponibilidad).",
      "Pulsa Publicar cuando el borrador sea válido (toast Planning publicado; puede indicar N naves).",
    ],
    bullets: [
      "KPIs: Capacidad equipo (horas totales · operarios × 5 días, restando festivos/ausencias); Horas asignadas (ocupación %; puede indicar horas en otras naves); Sin asignar (proyectos + horas pendientes); Estado planning (Publicado + fecha | Borrador | Sin generar).",
      "Por día (LUN–VIE): % ocupación, barra usado/capacidad; marca Festivo si aplica.",
      "Tabla Proyectos: pestañas Todos / Sin asignar. Columnas de avance, Riesgo (OK / Atención / Riesgo / Sin fecha), entrega, días, fin estimado, asignado/estimado/hecho/pendiente de la semana, procesos y Estrategia por proyecto.",
      "Estrategia por proyecto: presets A tiempo / Equilibrado / Mínimo coste; sliders Urgencia por entrega, Prioridad coste, Estabilidad; Guardar estrategia. Global: Aplicar estrategia a todos → elige preset → Aplicar.",
      "Deshacer: diálogo Deshacer planning. Si hay semanas posteriores, el checkbox Deshacer también las semanas posteriores puede ser obligatorio. Confirmación destructiva. Bloqueado si hay registros de horas (mensaje para usar Regenerar en su lugar).",
      "Banner ámbar si hay desviaciones de catálogo → enlace Ver desviaciones.",
    ],
    links: [
      { href: "/dashboard", label: "Resumen" },
      { href: "/dashboard/desviaciones-tiempos", label: "Desviaciones" },
    ],
  },
  {
    id: "vistas-planning-operario",
    title: "Cómo leer el planning",
    roles: OPERARIO_ONLY,
    paragraphs: [
      "Las vistas muestran el trabajo del planning publicado. Cambia de semana con WeekNav en la cabecera. Puedes alternar Plan | Registros para ver lo planificado frente a lo ya fichado en horas.",
    ],
    bullets: [
      "Vista semana: rejilla de personas × días. Vacío: No hay planning… (aún no hay publicado para esa semana).",
      "Por persona: una card por persona (avatar, totales, ausencias). Tú solo ves tu ficha si tu usuario está vinculado a una Persona. Layout Calendario | Lista. Botón Imprimir abre la impresión del navegador para el reparto en nave.",
      "Por proyecto: asignaciones de la semana agrupadas por proyecto (tareas, procesos, personas, progreso, riesgo).",
    ],
    links: [
      { href: "/dashboard/semana", label: "Vista semana" },
      { href: "/dashboard/persona", label: "Por persona" },
      { href: "/dashboard/proyecto", label: "Por proyecto" },
    ],
  },
  {
    id: "vistas-planning",
    title: "Vistas del planning",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Tras generar un borrador (o con un planning publicado), usa estas vistas para validar antes de publicar o para el día a día en nave.",
    ],
    bullets: [
      "Vista semana: grid personas × días. Toggle Plan | Registros y escala Semana | Mes. Botón Imprevista → Nueva tarea imprevista (Admin/Jefe). Panel de imprevistas pendientes si las hay. Vacío en plan: mensaje para volver a Resumen y Generar planning.",
      "Vista mes: calendario del mes con horas planificadas o registradas; festivos marcados; mismos toggles Plan/Registros y Semana/Mes. Pulsa un día para enfocarte en esa semana.",
      "Por persona: Plan | Registros; layout Calendario | Lista; Imprimir (window.print, barra no-print). Cards por operario con totales y ausencias. Operario solo se ve a sí mismo.",
      "Por proyecto: agrupación semanal por proyecto (tareas, procesos, OTs, personas, progreso, riesgo vs entrega/fin planificado, esperas de secado). En registros, Admin/Jefe pueden acciones de progreso.",
      "Gantt: eje Proyecto/Tareas o Trabajador/Tareas; filtros Todos/Ninguno + checkboxes; barras de trabajo y waits; hitos de entrega; Plan/Registros.",
      "Disponibilidad: horas libres y ocupación por persona/día. Columnas Plan y Reg. por día (verde bajo 50%, amarillo desde 50%, rojo desde 95%). Totales semanales Asig. / Libre. Capacidad resta festivos y ausencias.",
      "Desviaciones tiempos: Bastidor, Proceso, Catálogo, Media observada, Desviación %, Muestras, Estado. Admin puede configurar Umbral de desviación (Desviación máxima %, Ventana N muestras) y Guardar.",
    ],
    links: [
      { href: "/dashboard/semana", label: "Vista semana" },
      { href: "/dashboard/mes", label: "Vista mes" },
      { href: "/dashboard/persona", label: "Por persona" },
      { href: "/dashboard/proyecto", label: "Por proyecto" },
      { href: "/dashboard/gantt", label: "Gantt" },
      { href: "/dashboard/disponibilidad", label: "Disponibilidad" },
      { href: "/dashboard/desviaciones-tiempos", label: "Desviaciones" },
    ],
  },
  {
    id: "proyectos",
    title: "Proyectos y lámparas",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Proyectos agrupa el trabajo comercial/productivo. Cada proyecto tiene lámparas (con elementos o modo por horas) y tareas de proceso generadas desde el catálogo.",
    ],
    steps: [
      "Lista: pestañas Activos / Finalizados (y archivados si aplica). Nuevo proyecto → Nombre, Cliente, Obra, Fecha y hora de entrega, Tipo (Producción / Prototipo / Presupuesto), Responsable, Facturable → Crear.",
      "En la lista verás riesgo (semáforo por días a entrega: ≤7 Riesgo, ≤14 Atención), estado de aprobación (Pendiente de aprobación / Aprobación parcial / En producción), naves, horas Est./Hecho/Asig./Pend. y próximo proceso.",
      "Detalle del proyecto: Editar; KPIs de horas; Asignar desde stock si aplica.",
      "Añadir lámpara: nombre + elementos (tipología Tela/Bastidor/Iluminación, tipo, Medida m², unidades) o modo horas en Prototipo/Presupuesto.",
      "Por lámpara: checkbox Aprobada (incluye/excluye del planning), renombrar, eliminar, devolver a stock, editar elementos y revisar tareas (orden, proceso, horas, nave, OT, waits de secado, extras).",
      "Semáforo de riesgo del proyecto: OK / Atención / Riesgo / Sin fecha según entrega y fin planificado.",
      "Zona peligrosa: archivar o borrar (solo si no hay time entries ni órdenes de producción asociadas).",
    ],
    links: [{ href: "/dashboard/proyectos", label: "Proyectos" }],
  },
  {
    id: "catalogo",
    title: "Catálogo de elementos y procesos",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Elementos es el motor de tiempos: tipologías, procesos y horas por unidad o fijas. De aquí salen las tareas al crear lámparas.",
    ],
    bullets: [
      "Catálogo de elementos: Nuevo elemento (código, nombre, tipología, nave por defecto o heredar tipología, imagen, cadena de procesos con h/unidad, horas fijas, nave por proceso, reordenar). Editar, Duplicar, archivar/reactivar, eliminar.",
      "Procesos: crear (código en MAYÚSCULAS_, etiqueta, waitHours de secado), editar (wait, setup, color, puede fragmentarse), borrar (bloqueado si está en uso en tareas o especialidades).",
      "Naves por tipología: nave por defecto por tipología; afecta a la herencia al crear elementos.",
      "Las especialidades del personal no cambian estas horas: solo deciden quién puede hacer el proceso.",
    ],
    links: [{ href: "/dashboard/catalogo", label: "Elementos" }],
  },
  {
    id: "personal",
    title: "Personal, especialidades y ausencias",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Personal define quién trabaja en cada nave, con qué procesos y en qué ventanas. El motor de planning usa esto para asignar.",
    ],
    bullets: [
      "Nueva persona / Editar: iniciales, color, tarifa h, overtime, nave, usuario vinculado, activo, notas. Filtro por nave en la lista.",
      "Especialidades: por proceso elige ninguno, Responsable (prioridad alta en el planning) o Apoyo / sustituto (prioridad menor, cubre huecos).",
      "Horario: Lun–Vie mañana (+ tarde opcional) → Guardar → Horario guardado.",
      "Ausencias: calendario; modos Franja | Día | Rango; Motivo obligatorio. Las vacaciones personales van aquí (no como festivo de empresa).",
      "Una ausencia reduce capacidad; regenera el planning de la semana afectada para que el motor la respete.",
      "Lámparas por horas (presupuesto/prototipo): pueden asignarse a cualquier operario activo de la nave; no hace falta una especialidad Estimación manual.",
    ],
    links: [{ href: "/dashboard/personal", label: "Personal" }],
  },
  {
    id: "mis-horas",
    title: "Mis horas (timer y manual)",
    roles: OPERARIO_ONLY,
    paragraphs: [
      "Mis horas es tu pantalla principal de producción. Muestra la cola / tarea activa: proyecto, lámpara, elemento, medida (m²/uds), proceso, OT, franja planificada y estimado.",
      "Estados de cola: Activa (en curso), Libre (puedes iniciar), Bloqueada (precedencia o secado).",
    ],
    steps: [
      "Iniciar: arranca el timer (Fichando HH:MM:SS). Si ya tienes otro timer: primero para el contador activo.",
      "Parar: detiene el timer y guarda el tramo.",
      "Completar 1: marca la tarea actual como completada.",
      "Completar varias: si la OT tiene más de un producto pendiente, indica la cantidad; el tiempo se reparte proporcionalmente por horas estimadas.",
      "Registro manual: abre el formulario (proyecto / lámpara / tarea suelen venir de la tarea activa). Añade Rangos Inicio/Fin (Añadir rango). Toggle Completar tarea al guardar Sí/No. Si es OT con varios productos, Cantidad de tareas de la OT completadas. Si cruza descanso: Coincide con franja de descanso → He trabajado extra | He hecho descanso. Registrar.",
    ],
    bullets: [
      "Bloqueada: aún no se ha completado {proceso anterior} — respeta la secuencia productiva.",
      "En espera por secado hasta {fecha/hora} — waitHours del proceso previo; no inicies hasta entonces.",
      "Puedes seleccionar otra tarea libre de la cola si la siguiente está bloqueada (el sistema puede recomendar la siguiente lógica).",
      "Imprevistas: panel de tareas AD_HOC asignadas a ti; también puedes iniciar timer sobre ellas.",
      "Esta semana: lista de tus entradas de tiempo.",
    ],
    links: [{ href: "/dashboard/horas", label: "Mis horas" }],
  },
  {
    id: "horas-fichaje-jefe",
    title: "Horas del equipo y fichaje",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Los operarios registran el tiempo de proyecto en Mis horas (timer, completar, manual e imprevistas). Tú supervisas presencia en Fichaje diario y el desajuste plan vs real en Desviaciones y en las vistas Plan | Registros.",
    ],
    bullets: [
      "En Mis horas (si entras como jefe vinculado): misma cola, timer y manual; Admin puede editar entradas de otros en la lista semanal según permisos de la pantalla.",
      "Fichaje diario: presencia, ausencias personales y festivos de empresa. Select de persona (tú ves a todo el equipo; el operario solo a sí mismo).",
      "Controles del día: Iniciar jornada / Finalizar jornada; Iniciar descanso / Finalizar descanso; franja manual Inicio/Fin. Lista de sesiones: editar, Eliminar, pausas (Añadir pausa / editar / eliminar).",
      "Festivos (Admin/Jefe): Inicio/Fin, Nombre, Añadir festivo / editar / eliminar. Restan capacidad del planning.",
      "Admin no tiene Mis horas en el menú; el alta de horas de proyecto la hacen los operarios.",
    ],
    links: [
      { href: "/dashboard/fichaje-diario", label: "Fichaje diario" },
      { href: "/dashboard/desviaciones-tiempos", label: "Desviaciones" },
    ],
  },
  {
    id: "fichaje",
    title: "Fichaje diario",
    roles: OPERARIO_ONLY,
    paragraphs: [
      "Fichaje diario registra tu presencia (jornada y descansos), no el detalle de proyecto. El detalle de lámpara/proceso va en Mis horas.",
    ],
    steps: [
      "Abre el calendario: colores para fichajes, ausencia y festivo (pasa el cursor para el detalle).",
      "Iniciar jornada al empezar; Finalizar jornada al terminar.",
      "Iniciar descanso / Finalizar descanso para pausas, o añade franjas manuales Inicio/Fin.",
      "En la lista de sesiones puedes editar Inicio/Fin, Eliminar y gestionar pausas (Añadir pausa).",
      "Si tienes ausencia ese día (vacaciones, etc.) aparecerá en la vista; el alta de ausencias largas la suele hacer el jefe en Personal.",
    ],
    links: [{ href: "/dashboard/fichaje-diario", label: "Fichaje diario" }],
  },
  {
    id: "stock",
    title: "Stock",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Stock es el pool de lámparas/elementos aún no ligados a un proyecto de producción, o reutilizables.",
    ],
    bullets: [
      "Nuevo lote → Crear lote de stock: nombre + elementos (como al crear lámparas).",
      "Tabla: nombre, tipología, estado En producción / Disponible / Asignada, lotes, horas pendientes, proyecto previo.",
      "Asignar a un proyecto desde el diálogo; detalle en la ficha del lote; borrar si está permitido.",
      "Desde un proyecto: Asignar desde stock / Devolver a stock en la lámpara.",
    ],
    links: [{ href: "/dashboard/stock", label: "Stock" }],
  },
  {
    id: "ordenes-trabajo",
    title: "Órdenes de trabajo",
    roles: ADMIN_ONLY,
    paragraphs: [
      "Las OT agrupan tareas elegibles para seguimiento y alertas en producción. Pantalla solo Admin.",
    ],
    bullets: [
      "Filtros Abiertas / Cerradas / Todas; ordenación por columnas.",
      "Nueva OT; Agrupar procesos iguales; Dividir OT; editar; borrar; umbrales de alerta.",
      "Elige tareas elegibles; badges de atención cuando hay incidencias.",
    ],
    links: [{ href: "/dashboard/admin/ordenes-trabajo", label: "Órdenes de trabajo" }],
  },
  {
    id: "costes",
    title: "Costes",
    roles: JEFE_ADMIN,
    paragraphs: [
      "Panel privado (solo Jefe y Admin). Calcula coste ≈ horas planificadas × tarifa horaria del operario. Cambia de semana con WeekNav.",
    ],
    bullets: [
      "KPIs: Coste semana, Coste facturable, No facturable.",
      "Tablas: coste por proyecto (marca Facturable), por persona, ranking de rendimiento (asignado/capacidad).",
    ],
    links: [{ href: "/dashboard/costes", label: "Costes" }],
  },
  {
    id: "admin",
    title: "Administración",
    roles: ADMIN_ONLY,
    paragraphs: [
      "Estas pantallas solo las ve el Administrador. Configuran el sistema para que jefes y operarios puedan trabajar.",
    ],
    bullets: [
      "Naves: Nueva nave (código, nombre); editar; activar/desactivar; ver personas/tareas/lámparas asociadas.",
      "Usuarios: Crear/editar Nombre, Email, Password, Rol (Admin / Jefe de producción / Operario). Nave obligatoria si el rol es Operario. Vincula el usuario a una Persona en Personal para horas y Por persona.",
      "En Usuarios, tabla de suscripciones: Tipo de alerta × canales Interna / Email / Push (activa por tipo; push suele ir desactivado por defecto).",
      "Trazabilidad: filtros (búsqueda, fechas, categoría, acción, usuario, tipo de entidad, Éxito/Fallo); tabla paginada; detalle JSON en diálogo.",
      "Importar / exportar: Exportar plataforma (Desde/Hasta → Descargar Excel, filtra por inicio de registros de horas). Importaciones: wizard Excel (detecta PRODUCCION.xlsx) → mapear columnas → revisar → confirmar.",
    ],
    links: [
      { href: "/dashboard/admin/naves", label: "Naves" },
      { href: "/dashboard/admin/usuarios", label: "Usuarios" },
      { href: "/dashboard/admin/trazabilidad", label: "Trazabilidad" },
      { href: "/dashboard/admin/export", label: "Importar / exportar" },
    ],
  },
  {
    id: "notificaciones",
    title: "Notificaciones",
    roles: ALL,
    paragraphs: [
      "Notificaciones concentra los avisos de la plataforma. Filtra Todos / Sin leer / Leído. Marcar visibles como leídas o como no leídas. En cada card: tipo, fecha, título, cuerpo; Marcar leída/no leída; enlace de acción si aplica.",
    ],
    bullets: [
      "Ejemplos de tipos: plan publicado con ocupación bajo el 100%; proyectos fuera de plazo; tareas por encima de lo estimado; desviación de tiempos del catálogo; proyectos que se alargan; tareas sin partes de horas; fichajes fuera de horario / abiertos demasiado / incompletos / día sin fichaje; fallo de envío.",
      "Push del navegador: la app puede pedir permiso y registrar el service worker; los canales Push se configuran por tipo de alerta en Admin → Usuarios.",
    ],
    links: [{ href: "/dashboard/notificaciones", label: "Notificaciones" }],
  },
];

const FAQ: HelpFaqItem[] = [
  {
    id: "faq-no-veo-pantalla",
    question: "No veo una pantalla que me han mencionado",
    answer:
      "El menú depende del rol. Operario no ve Resumen, mes, Gantt, catálogo, personal ni Admin. Jefe no ve Naves, Usuarios, Trazabilidad, OT admin ni Importar/exportar. Si crees que te falta acceso, habla con un administrador para revisar tu rol y nave.",
    roles: ALL,
  },
  {
    id: "faq-timer",
    question: "El timer no me deja iniciar una tarea",
    answer:
      "Si la cola está Bloqueada verás el motivo: aún no se ha completado el proceso anterior, o hay espera por secado hasta una fecha/hora. Para el timer activo si tienes otro en marcha. Elige otra tarea Libre de la cola si la siguiente lógica sigue bloqueada.",
    roles: OPERARIO_ONLY,
  },
  {
    id: "faq-completar-varias",
    question: "¿Cuándo uso Completar varias?",
    answer:
      "Cuando la OT agrupa varios productos (aunque sean de proyectos o tipos distintos). Indica la cantidad; el tiempo del tramo se reparte proporcionalmente por horas estimadas. Completar 1 solo cierra la unidad actual.",
    roles: OPERARIO_ONLY,
  },
  {
    id: "faq-solo-mi-ficha",
    question: "En Por persona solo veo mi ficha",
    answer:
      "Es el comportamiento esperado si tu usuario está vinculado a una Persona: ves tu reparto. Jefe y Admin ven a todo el equipo de la nave.",
    roles: OPERARIO_ONLY,
  },
  {
    id: "faq-fichaje-vs-horas",
    question: "¿Qué diferencia hay entre Fichaje diario y Mis horas?",
    answer:
      "Fichaje diario = presencia (jornada y descansos). Mis horas = tiempo de producción ligado a proyecto/lámpara/proceso/OT. Conviene usar ambos: presencia + detalle productivo.",
    roles: OPERARIO_ONLY,
  },
  {
    id: "faq-no-genera",
    question: "No puedo generar o publicar el planning",
    answer:
      "Confirma rol Jefe/Admin. Generar/Publicar/Deshacer quedan deshabilitados si hay una nave concreta seleccionada: el Admin debe poner el selector en Todas (el planning se opera para todas las naves). Revisa alcance, proyectos con horas pendientes y los Avisos del planning al terminar el job. Un borrador no es definitivo hasta Publicar.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-borrador",
    question: "Generé el planning pero el equipo no lo ve",
    answer:
      "Generar crea borrador. Jefe y operario solo ven planning publicado: usa Publicar. Admin puede previsualizar con el toggle + borrador en la cabecera de Planning.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-deshacer",
    question: "No puedo deshacer el planning",
    answer:
      "Si hay registros de horas en esa semana, Deshacer se bloquea: usa Regenerar. Si hay semanas posteriores generadas, deberás deshacer también esas semanas (checkbox obligatorio en el diálogo).",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-nave-incorrecta",
    question: "El planning sale vacío o con datos de otra nave",
    answer:
      "Revisa el selector de nave en Planning. Admin: Todas vs una nave concreta. Tras el login admin, confirma que elegiste la nave correcta. Regenera o publica en el ámbito adecuado.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-especialidades",
    question: "¿Las especialidades cambian las horas estimadas?",
    answer:
      "No. Responsable y Apoyo / sustituto solo influyen en quién puede recibir la tarea y en qué orden de preferencia. Las horas vienen del catálogo (y del bastidor/medida) o del total de horas de la lámpara en prototipo/presupuesto.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-aprobada",
    question: "Una lámpara no entra en el planning",
    answer:
      "Comprueba el checkbox Aprobada en la lámpara del proyecto: si no está aprobada, se excluye del motor. Revisa también tipología/elementos, nave del proceso y que el proyecto tenga horas pendientes.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-ausencias",
    question: "He registrado una ausencia y el planning no cambia",
    answer:
      "Las ausencias afectan a la disponibilidad en la siguiente generación. Vuelve a Generar/Regenerar el borrador de la semana y revisa Disponibilidad antes de Publicar.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-estrategia",
    question: "¿Para qué sirven los presets de estrategia?",
    answer:
      "A tiempo / Equilibrado / Mínimo coste (y los sliders de urgencia, coste y estabilidad) sesgan cómo el motor prioriza proyectos. Puedes Guardar estrategia en un proyecto o Aplicar estrategia a todos. Los ajustes globales (Estrategia en Resumen) afectan refuerzo de entrega y penalizaciones fuera de fecha.",
    roles: JEFE_ADMIN,
  },
  {
    id: "faq-import",
    question: "¿Cómo sincronizo Excel o exporto datos?",
    answer:
      "Admin → Importar / exportar. Exportar plataforma: elige Desde/Hasta y Descargar Excel. Importaciones: sube el Excel (p. ej. PRODUCCION.xlsx), mapea columnas, revisa y confirma. Para cargas técnicas por script, el equipo técnico puede usar los scripts del repositorio.",
    roles: ADMIN_ONLY,
  },
  {
    id: "faq-usuarios",
    question: "Cómo doy de alta un operario",
    answer:
      "Usuarios: crea la cuenta con rol Operario y nave. En Personal, crea o edita la Persona (iniciales, color, especialidades, horario) y vincúlala a ese usuario. Sin vínculo, no podrá verse bien en Por persona ni en la cola de Mis horas.",
    roles: ADMIN_ONLY,
  },
  {
    id: "faq-push",
    question: "No llegan notificaciones push",
    answer:
      "El navegador debe haber concedido permiso. En Admin → Usuarios, activa el canal Push para los tipos de alerta deseados (por defecto suele estar apagado). Revisa también Notificaciones internas en la app.",
    roles: ADMIN_ONLY,
  },
];

const OPERARIO_FORBIDDEN_HREFS = new Set([
  "/dashboard",
  "/dashboard/mes",
  "/dashboard/gantt",
  "/dashboard/disponibilidad",
  "/dashboard/desviaciones-tiempos",
  "/dashboard/proyectos",
  "/dashboard/catalogo",
  "/dashboard/personal",
  "/dashboard/stock",
  "/dashboard/costes",
  "/dashboard/admin/naves",
  "/dashboard/admin/usuarios",
  "/dashboard/admin/trazabilidad",
  "/dashboard/admin/ordenes-trabajo",
  "/dashboard/admin/export",
]);

const ADMIN_FORBIDDEN_HREFS = new Set(["/dashboard/horas"]);

function filterLinksForRole(links: HelpLink[] | undefined, role: Role): HelpLink[] | undefined {
  if (!links?.length) return undefined;
  const filtered = links.filter((link) => {
    if (role === Role.OPERARIO && OPERARIO_FORBIDDEN_HREFS.has(link.href)) return false;
    if (role === Role.ADMIN && ADMIN_FORBIDDEN_HREFS.has(link.href)) return false;
    if (role !== Role.ADMIN && link.href.startsWith("/dashboard/admin/")) return false;
    return true;
  });
  return filtered.length > 0 ? filtered : undefined;
}

export function getHelpForRole(role: Role): HelpForRole {
  const meta = HELP_ROLE_META[role];
  const sections = SECTIONS.filter((section) => section.roles.includes(role)).map((section) => ({
    ...section,
    links: filterLinksForRole(section.links, role),
  }));
  const faq = FAQ.filter((item) => item.roles.includes(role));
  return { meta, sections, faq };
}
