"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Factory,
  Gauge,
  LayoutGrid,
  LineChart,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface EmpresaSummary {
  id: string;
  nombre: string;
  marca: string | null;
}

interface DashboardShellProps {
  user: { id: string; name: string; role: string; email: string };
  person: { iniciales: string; color: string } | null;
  empresas: EmpresaSummary[];
  activeEmpresa: EmpresaSummary;
  children: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    label: "Planning",
    items: [
      { href: "/dashboard", label: "Resumen", icon: LayoutGrid, exact: true },
      { href: "/dashboard/semana", label: "Vista semana", icon: CalendarDays },
      { href: "/dashboard/persona", label: "Por persona", icon: Users },
      { href: "/dashboard/proyecto", label: "Por proyecto", icon: ClipboardList },
      { href: "/dashboard/gantt", label: "Gantt", icon: LineChart },
      { href: "/dashboard/disponibilidad", label: "Disponibilidad", icon: Gauge },
    ],
  },
  {
    label: "Operativa",
    items: [
      { href: "/dashboard/horas", label: "Mis horas", icon: Timer },
      { href: "/dashboard/fabrica", label: "Fábrica", icon: Factory },
      { href: "/dashboard/ordenes", label: "Órdenes producción", icon: Package },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/dashboard/proyectos", label: "Proyectos", icon: ClipboardList },
      { href: "/dashboard/catalogo", label: "Bastidores", icon: Settings },
      { href: "/dashboard/personal", label: "Personal", icon: Users },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/dashboard/costes", label: "Costes", icon: ShieldCheck, restricted: true },
    ],
  },
] as const;

export function DashboardShell({
  user,
  person,
  empresas,
  activeEmpresa,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const onSwitchEmpresa = async (empresaId: string) => {
    await fetch("/api/empresa/switch", {
      method: "POST",
      body: JSON.stringify({ empresaId }),
      headers: { "Content-Type": "application/json" },
    });
    router.refresh();
  };

  const onSignOut = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  const canSeeRestricted = user.role !== "OPERARIO";

  return (
    <div className="flex min-h-screen w-full bg-secondary/30">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-card sticky top-0 h-screen overflow-y-auto no-print">
        <div className="px-5 py-5 border-b">
          <div className="text-lg font-black tracking-tight">CONTRACT+</div>
          <div className="text-[10px] font-bold tracking-[0.25em] text-primary uppercase mt-0.5">
            {activeEmpresa.marca ?? activeEmpresa.nombre}
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-5">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => {
              if ("restricted" in item && item.restricted) {
                return canSeeRestricted;
              }
              return true;
            });
            if (items.length === 0) return null;
            return (
              <div key={section.label}>
                <div className="px-2 mb-2 text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase">
                  {section.label}
                </div>
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
              <DropdownMenuLabel>
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold">{user.name}</div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {user.role}
                  </Badge>
                </div>
              </DropdownMenuLabel>
              {empresas.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Empresa activa
                  </DropdownMenuLabel>
                  {empresas.map((e) => (
                    <DropdownMenuItem
                      key={e.id}
                      onClick={() => onSwitchEmpresa(e.id)}
                      className={cn(
                        e.id === activeEmpresa.id && "bg-secondary font-semibold",
                      )}
                    >
                      {e.marca ?? e.nombre}
                    </DropdownMenuItem>
                  ))}
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
