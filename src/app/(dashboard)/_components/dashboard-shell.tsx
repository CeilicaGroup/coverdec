"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Gauge,
  LayoutGrid,
  LineChart,
  LogOut,
  Palmtree,
  Settings,
  ShieldCheck,
  Timer,
  Users,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

interface DashboardShellProps {
  user: { id: string; name: string; role: string; email: string };
  person: { iniciales: string; color: string } | null;
  naves: NaveSummary[];
  activeNave: NaveSummary | null;
  /** Naves assigned to the linked person (operario/jefe). */
  assignedNaves?: NaveSummary[];
  children: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    label: "Planning",
    naveScoped: true,
    items: [
      { href: "/dashboard", label: "Resumen", icon: LayoutGrid, exact: true, operarioHidden: true },
      { href: "/dashboard/semana", label: "Vista semana", icon: CalendarDays },
      { href: "/dashboard/persona", label: "Por persona", icon: Users },
      { href: "/dashboard/proyecto", label: "Por proyecto", icon: ClipboardList },
      { href: "/dashboard/gantt", label: "Gantt", icon: LineChart, operarioHidden: true },
      { href: "/dashboard/disponibilidad", label: "Disponibilidad", icon: Gauge, operarioHidden: true },
      { href: "/dashboard/festivos", label: "Festivos", icon: Palmtree },
    ],
  },
  {
    label: "Operativa",
    naveScoped: false,
    items: [
      { href: "/dashboard/horas", label: "Mis horas", icon: Timer, adminHidden: true },
    ],
  },
  {
    label: "Catálogo",
    naveScoped: false,
    items: [
      { href: "/dashboard/proyectos", label: "Proyectos", icon: ClipboardList, operarioHidden: true },
      { href: "/dashboard/catalogo", label: "Bastidores", icon: Settings, operarioHidden: true },
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
    ],
  },
] as const;

export function DashboardShell({
  user,
  person,
  naves,
  activeNave,
  assignedNaves = [],
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const onSwitchNave = async (naveId: string) => {
    await fetch("/api/nave/switch", {
      method: "POST",
      body: JSON.stringify({ naveId }),
      headers: { "Content-Type": "application/json" },
    });
    router.refresh();
  };

  const onSignOut = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  const isOperario = user.role === "OPERARIO";
  const canSeeRestricted = !isOperario;
  const isAdmin = user.role === "ADMIN";
  const canSwitchNave = isAdmin;

  return (
    <div className="flex min-h-screen w-full bg-secondary/30">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-card sticky top-0 h-screen overflow-y-auto no-print">
        <div className="px-5 py-5 border-b">
          <div className="text-lg font-black tracking-tight">CONTRACT+</div>
          {activeNave && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Warehouse className="size-3" />
              <span className="font-mono font-semibold">{activeNave.codigo}</span>
              <span className="truncate">{activeNave.nombre}</span>
            </div>
          )}
          {!activeNave && assignedNaves.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {assignedNaves.map((n) => (
                <Badge key={n.id} variant="secondary" className="text-[9px] font-mono px-1.5 py-0">
                  {n.codigo}
                </Badge>
              ))}
            </div>
          )}
          {!activeNave && assignedNaves.length === 0 && isAdmin && (
            <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
              Sin nave asignada
            </div>
          )}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-5">
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
                  <div className="px-2 mb-2">
                    <select
                      value={activeNave?.id ?? ""}
                      onChange={(e) => onSwitchNave(e.target.value)}
                      className="w-full text-[11px] font-mono bg-secondary border border-border rounded px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {canSeeRestricted && (
                        <option value="">— Todas las naves —</option>
                      )}
                      {naves.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.codigo} · {n.nombre}
                        </option>
                      ))}
                    </select>
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
        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2.5 h-auto py-2"
                />
              }
            >
              <Avatar className="size-8">
                <AvatarFallback
                  style={person ? { background: person.color, color: "white" } : undefined}
                >
                  {person?.iniciales ?? user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left overflow-hidden">
                <div className="text-sm font-semibold truncate">{user.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold">{user.name}</div>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {user.role}
                    </Badge>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              {isAdmin && naves.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Nave activa
                    </DropdownMenuLabel>
                    {naves.map((n) => (
                      <DropdownMenuItem
                        key={n.id}
                        onClick={() => onSwitchNave(n.id)}
                        className={cn(
                          n.id === activeNave?.id && "bg-secondary font-semibold",
                        )}
                      >
                        <Warehouse className="size-3.5 mr-1.5 opacity-60" />
                        {n.nombre}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-destructive">
                <LogOut className="size-4 mr-2" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
