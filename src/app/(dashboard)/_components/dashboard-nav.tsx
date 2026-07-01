"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PlanningViewToggle } from "./planning-view-toggle";
import type { PlanningViewMode } from "@/features/planning/planning-visibility";

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

const NAV_SECTIONS = [
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
      { href: "/dashboard/desviaciones-tiempos", label: "Desviaciones tiempos", icon: AlertTriangle, operarioHidden: true },
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
] as const;

interface DashboardNavProps {
  userRole: string;
  naves: NaveSummary[];
  activeNave: NaveSummary | null;
  planningViewMode: PlanningViewMode;
  onSwitchNave: (naveId: string) => void;
  onNavigate?: () => void;
  className?: string;
}

export function DashboardNav({
  userRole,
  naves,
  activeNave,
  planningViewMode,
  onSwitchNave,
  onNavigate,
  className,
}: DashboardNavProps) {
  const pathname = usePathname();
  const isOperario = userRole === "OPERARIO";
  const canSeeRestricted = !isOperario;
  const isAdmin = userRole === "ADMIN";
  const isJefeProduccion = userRole === "JEFE_PRODUCCION";
  const canSwitchNave = isAdmin || isJefeProduccion;

  return (
    <nav className={cn("flex-1 px-3 py-4 space-y-5", className)}>
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => {
          if ("adminOnly" in item && item.adminOnly) return isAdmin;
          if ("adminHidden" in item && item.adminHidden && isAdmin) return false;
          if ("restricted" in item && item.restricted) return canSeeRestricted;
          if ("operarioHidden" in item && item.operarioHidden && isOperario) return false;
          return true;
        });
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <div className="px-2 mb-1.5 flex items-center gap-1 text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase">
              {section.label}
              {section.naveScoped && <Warehouse className="size-3 opacity-50 ml-0.5" />}
            </div>
            {section.naveScoped && canSwitchNave && naves.length > 0 && (
              <div className="px-2 mb-2 space-y-2">
                <select
                  value={activeNave?.id ?? ""}
                  onChange={(e) => onSwitchNave(e.target.value)}
                  className="w-full text-[11px] font-mono bg-secondary border border-border rounded px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {isAdmin ? <option value="">— Todas las naves —</option> : null}
                  {naves.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.codigo} · {n.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {section.naveScoped && isAdmin && (
              <div className="px-2 mb-2">
                <PlanningViewToggle mode={planningViewMode} />
              </div>
            )}
            <div className="space-y-0.5">
              {items.map((item) => {
                const active =
                  "exact" in item && item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground/70 hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function DashboardBrand({
  activeNave,
  assignedNaves,
  isAdmin,
  compact = false,
}: {
  activeNave: NaveSummary | null;
  assignedNaves: NaveSummary[];
  isAdmin: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn(compact ? "min-w-0" : "px-5 py-5 border-b")}>
      <div className={cn("font-black tracking-tight", compact ? "text-base" : "text-lg")}>
        CONTRACT+
      </div>
      {activeNave && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Warehouse className="size-3 shrink-0" />
          <span className="font-mono font-semibold">{activeNave.codigo}</span>
          {!compact && <span className="truncate">{activeNave.nombre}</span>}
        </div>
      )}
      {!activeNave && assignedNaves.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {assignedNaves.map((n) => (
            <Badge key={n.id} variant="secondary" className="text-[9px] font-mono px-1.5 py-0">
              {n.codigo}
            </Badge>
          ))}
        </div>
      )}
      {!activeNave && assignedNaves.length === 0 && isAdmin && !compact && (
        <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
          Sin nave asignada
        </div>
      )}
    </div>
  );
}
