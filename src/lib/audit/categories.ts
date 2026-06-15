export const AUDIT_CATEGORIES = [
  "attendance",
  "auth",
  "catalog",
  "factory",
  "holidays",
  "imports",
  "naves",
  "notifications",
  "people",
  "planning",
  "production-orders",
  "projects",
  "time-tracking",
  "admin",
  "api",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export function resolveAuditCategory(action: string): string {
  const prefix = action.split(".")[0];
  if (!prefix) return "unknown";
  if ((AUDIT_CATEGORIES as readonly string[]).includes(prefix)) return prefix;
  return prefix;
}

export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  attendance: "Fichaje",
  auth: "Autenticación",
  catalog: "Catálogo",
  factory: "Fábrica",
  holidays: "Festivos",
  imports: "Importaciones",
  naves: "Naves",
  notifications: "Notificaciones",
  people: "Personal",
  planning: "Planning",
  "production-orders": "Órdenes de producción",
  projects: "Proyectos",
  "time-tracking": "Registro de horas",
  admin: "Administración",
  api: "API",
};

export function formatAuditCategoryLabel(category: string): string {
  return AUDIT_CATEGORY_LABELS[category] ?? category;
}

export function formatAuditActionLabel(action: string): string {
  const [, ...rest] = action.split(".");
  if (rest.length === 0) return action;
  return rest.join(".");
}
