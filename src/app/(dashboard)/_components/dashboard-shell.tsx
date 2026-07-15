"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DashboardBrand, DashboardNav } from "./dashboard-nav";
import { DashboardTopNav } from "./dashboard-top-nav";
import { DashboardUserMenu } from "./dashboard-user-menu";
import type { PlanningViewMode } from "@/features/planning/planning-visibility";
import type { DevSwitcherUserRow } from "@/features/dev/user-switcher-actions";

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
  devUserSwitcherEnabled?: boolean;
  devSwitcherUsers?: DevSwitcherUserRow[];
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  person,
  naves,
  activeNave,
  assignedNaves = [],
  planningViewMode = "published_only",
  devUserSwitcherEnabled = false,
  devSwitcherUsers = [],
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
    <div className="flex min-h-screen w-full flex-col bg-secondary/30">
      <header className="sticky top-0 z-40 no-print">
        <DashboardTopNav
          user={user}
          person={person}
          userRole={user.role}
          naves={naves}
          activeNave={activeNave}
          assignedNaves={assignedNaves}
          planningViewMode={planningViewMode}
          onSwitchNave={onSwitchNave}
          onOpenMobileMenu={() => setMobileNavOpen(true)}
          showMobileMenuButton
          devUserSwitcherEnabled={devUserSwitcherEnabled}
          devSwitcherUsers={devSwitcherUsers}
        />
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="flex h-full max-h-dvh w-[min(18rem,calc(100vw-2rem))] flex-col gap-0 p-0"
        >
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
            className="min-h-0 flex-1 overflow-y-auto"
          />
          <div className="shrink-0 border-t bg-card p-3">
            <DashboardUserMenu
              user={user}
              person={person}
              devUserSwitcherEnabled={devUserSwitcherEnabled}
              devSwitcherUsers={devSwitcherUsers}
            />
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
