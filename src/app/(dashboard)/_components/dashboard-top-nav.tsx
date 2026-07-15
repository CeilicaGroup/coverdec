"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlanningViewToggle } from "./planning-view-toggle";
import type { PlanningViewMode } from "@/features/planning/planning-visibility";
import {
  type NaveSummary,
  filterNavSections,
  findActiveSection,
  isNavItemActive,
} from "./dashboard-nav-config";
import { DashboardBrand } from "./dashboard-nav";
import { DashboardUserMenu } from "./dashboard-user-menu";
import type { DevSwitcherUserRow } from "@/features/dev/user-switcher-actions";

interface DashboardTopNavProps {
  user: { id: string; name: string; role: string; email: string };
  person: { iniciales: string; color: string } | null;
  userRole: string;
  naves: NaveSummary[];
  activeNave: NaveSummary | null;
  assignedNaves: NaveSummary[];
  planningViewMode: PlanningViewMode;
  onSwitchNave: (naveId: string) => void;
  onOpenMobileMenu?: () => void;
  showMobileMenuButton?: boolean;
  devUserSwitcherEnabled?: boolean;
  devSwitcherUsers?: DevSwitcherUserRow[];
}

export function DashboardTopNav({
  user,
  person,
  userRole,
  naves,
  activeNave,
  assignedNaves,
  planningViewMode,
  onSwitchNave,
  onOpenMobileMenu,
  showMobileMenuButton = false,
  devUserSwitcherEnabled = false,
  devSwitcherUsers = [],
}: DashboardTopNavProps) {
  const pathname = usePathname();
  const isAdmin = userRole === "ADMIN";
  const isJefeProduccion = userRole === "JEFE_PRODUCCION";
  const canSwitchNave = isAdmin || isJefeProduccion;
  const sections = filterNavSections(userRole);
  const activeSection = findActiveSection(pathname, userRole);

  return (
    <div className="border-b bg-card no-print">
      <div className="flex items-center gap-2 px-3 lg:px-4 h-14 min-w-0">
        {showMobileMenuButton ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            onClick={onOpenMobileMenu}
            aria-label="Abrir menú"
          >
            <Menu className="size-5" />
          </Button>
        ) : null}

        <DashboardBrand
          activeNave={activeNave}
          assignedNaves={assignedNaves}
          isAdmin={isAdmin}
          compact
        />

        <nav
          className="hidden lg:flex items-center gap-0.5 ml-4 min-w-0"
          aria-label="Grupos de navegación"
        >
          {sections.map((section) => {
            const sectionActive = activeSection?.label === section.label;
            const firstHref = section.items[0]?.href ?? "/dashboard";
            return (
              <Link
                key={section.label}
                href={firstHref}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide uppercase whitespace-nowrap transition-colors",
                  sectionActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {activeSection?.naveScoped && canSwitchNave && naves.length > 0 ? (
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <Warehouse className="size-3.5 text-muted-foreground shrink-0" />
            <select
              value={activeNave?.id ?? ""}
              onChange={(e) => onSwitchNave(e.target.value)}
              className="max-w-[10rem] lg:max-w-[12rem] text-[11px] font-mono bg-secondary border border-border rounded px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Seleccionar nave"
            >
              {isAdmin ? <option value="">Todas</option> : null}
              {naves.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.codigo} · {n.nombre}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {activeSection?.naveScoped && isAdmin ? (
          <div className="hidden md:block shrink-0">
            <PlanningViewToggle mode={planningViewMode} />
          </div>
        ) : null}

        <div className="shrink-0">
          <DashboardUserMenu
            user={user}
            person={person}
            compact
            devUserSwitcherEnabled={devUserSwitcherEnabled}
            devSwitcherUsers={devSwitcherUsers}
          />
        </div>
      </div>

      {activeSection ? (
        <div className="max-lg:hidden border-t px-3 lg:px-4 py-1.5 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {activeSection.items.map((item) => {
              const active = isNavItemActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{item.label.split(" ").slice(-1)[0]}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
