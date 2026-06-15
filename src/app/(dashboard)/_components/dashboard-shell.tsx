"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DashboardBrand, DashboardNav } from "./dashboard-nav";
import { DashboardUserMenu } from "./dashboard-user-menu";
import type { PlanningViewMode } from "@/features/planning/planning-visibility";

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
  assignedNaves?: NaveSummary[];
  planningViewMode?: PlanningViewMode;
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  person,
  naves,
  activeNave,
  assignedNaves = [],
  planningViewMode = "published_only",
  children,
}: DashboardShellProps) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const onSwitchNave = async (naveId: string) => {
    await fetch("/api/nave/switch", {
      method: "POST",
      body: JSON.stringify({ naveId }),
      headers: { "Content-Type": "application/json" },
    });
    router.refresh();
  };

  const isAdmin = user.role === "ADMIN";

  return (
    <div className="flex min-h-screen w-full bg-secondary/30">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-card sticky top-0 h-screen overflow-y-auto no-print">
        <DashboardBrand
          activeNave={activeNave}
          assignedNaves={assignedNaves}
          isAdmin={isAdmin}
        />
        <DashboardNav
          userRole={user.role}
          naves={naves}
          activeNave={activeNave}
          planningViewMode={planningViewMode}
          onSwitchNave={onSwitchNave}
        />
        <div className="border-t p-3">
          <DashboardUserMenu
            user={user}
            person={person}
            naves={naves}
            activeNave={activeNave}
            isAdmin={isAdmin}
            onSwitchNave={onSwitchNave}
          />
        </div>
      </aside>

      <header className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center gap-2 border-b bg-card px-3 h-14 no-print">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Abrir menú"
        >
          <Menu className="size-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <DashboardBrand
            activeNave={activeNave}
            assignedNaves={assignedNaves}
            isAdmin={isAdmin}
            compact
          />
        </div>
        <DashboardUserMenu
          user={user}
          person={person}
          naves={naves}
          activeNave={activeNave}
          isAdmin={isAdmin}
          onSwitchNave={onSwitchNave}
          compact
        />
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[min(18rem,calc(100vw-2rem))] p-0 gap-0">
          <DashboardBrand
            activeNave={activeNave}
            assignedNaves={assignedNaves}
            isAdmin={isAdmin}
          />
          <DashboardNav
            userRole={user.role}
            naves={naves}
            activeNave={activeNave}
            planningViewMode={planningViewMode}
            onSwitchNave={onSwitchNave}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">{children}</main>
    </div>
  );
}
