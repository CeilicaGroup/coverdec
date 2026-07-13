"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
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

interface DashboardUserMenuProps {
  user: { name: string; role: string; email: string };
  person: { iniciales: string; color: string } | null;
  compact?: boolean;
}

export function DashboardUserMenu({
  user,
  person,
  compact = false,
}: DashboardUserMenuProps) {
  const router = useRouter();

  const onSignOut = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full size-9"
            aria-label="Menú de usuario"
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
        {!compact ? (
          <div className="flex-1 text-left overflow-hidden">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
          </div>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? "end" : "start"}
        side="bottom"
        sideOffset={8}
        className="z-[60] w-56"
      >
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} className="text-destructive">
          <LogOut className="size-4 mr-2" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
