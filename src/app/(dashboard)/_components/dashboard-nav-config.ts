import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  Bell,
  ClipboardList,
  Gauge,
  FileSpreadsheet,
  LayoutGrid,
  LineChart,
  AlertTriangle,
  ScrollText,
  ListOrdered,
  Settings,
  ShieldCheck,
  Timer,
  Users,
  Warehouse,
} from "lucide-react";

export interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  operarioHidden?: boolean;
  adminHidden?: boolean;
  adminOnly?: boolean;
  restricted?: boolean;
}

export interface NavSection {
  label: string;
  naveScoped: boolean;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Planning",
    naveScoped: true,
    items: [
      { href: "/dashboard", label: "Resumen", icon: LayoutGrid, exact: true, operarioHidden: true },
      { href: "/dashboard/semana", label: "Vista semana", icon: CalendarDays },
      { href: "/dashboard/mes", label: "Vista mes", icon: CalendarDays, operarioHidden: true },
      { href: "/dashboard/persona", label: "Por persona", icon: Users },
      { href: "/dashboard/proyecto", label: "Por proyecto", icon: ClipboardList },
      { href: "/dashboard/gantt", label: "Gantt", icon: LineChart, operarioHidden: true },
      { href: "/dashboard/disponibilidad", label: "Disponibilidad", icon: Gauge, operarioHidden: true },
      {
        href: "/dashboard/desviaciones-tiempos",
        label: "Desviaciones tiempos",
        icon: AlertTriangle,
        operarioHidden: true,
      },
    ],
  },
  {
    label: "Operativa",
    naveScoped: false,
    items: [
      { href: "/dashboard/fichaje-diario", label: "Fichaje diario", icon: Timer },
      { href: "/dashboard/horas", label: "Mis horas", icon: Timer, adminHidden: true },
      { href: "/dashboard/notificaciones", label: "Notificaciones", icon: Bell },
    ],
  },
  {
    label: "Catálogo",
    naveScoped: false,
    items: [
      { href: "/dashboard/proyectos", label: "Proyectos", icon: ClipboardList, operarioHidden: true },
      { href: "/dashboard/stock", label: "Stock", icon: Warehouse, operarioHidden: true },
      { href: "/dashboard/catalogo", label: "Elementos", icon: Settings, operarioHidden: true },
      { href: "/dashboard/personal", label: "Personal", icon: Users, operarioHidden: true },
    ],
  },
  {
    label: "Admin",
    naveScoped: false,
    items: [
      { href: "/dashboard/costes", label: "Costes", icon: ShieldCheck, restricted: true },
      { href: "/dashboard/admin/naves", label: "Naves", icon: Warehouse, adminOnly: true },
      { href: "/dashboard/admin/usuarios", label: "Usuarios", icon: Users, adminOnly: true },
      { href: "/dashboard/admin/trazabilidad", label: "Trazabilidad", icon: ScrollText, adminOnly: true },
      { href: "/dashboard/admin/ordenes-trabajo", label: "Órdenes de trabajo", icon: ListOrdered, adminOnly: true },
      { href: "/dashboard/admin/export", label: "Importar / exportar", icon: FileSpreadsheet, adminOnly: true },
    ],
  },
];

export function filterNavItems(items: NavItem[], userRole: string): NavItem[] {
  const isOperario = userRole === "OPERARIO";
  const isAdmin = userRole === "ADMIN";
  const canSeeRestricted = !isOperario;

  return items.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (item.adminHidden && isAdmin) return false;
    if (item.restricted) return canSeeRestricted;
    if (item.operarioHidden && isOperario) return false;
    return true;
  });
}

export function filterNavSections(userRole: string): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: filterNavItems(section.items, userRole),
  })).filter((section) => section.items.length > 0);
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function findActiveSection(pathname: string, userRole: string): NavSection | null {
  for (const section of filterNavSections(userRole)) {
    if (section.items.some((item) => isNavItemActive(pathname, item))) {
      return section;
    }
  }
  return filterNavSections(userRole)[0] ?? null;
}
