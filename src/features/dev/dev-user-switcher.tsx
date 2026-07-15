"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DevSwitcherUserRow } from "@/features/dev/user-switcher-actions";
import { switchDevUser } from "@/features/dev/user-switcher-actions";
import {
  DEV_SWITCHER_ROLE_LABELS,
  formatDevSwitcherUserLabel,
  groupDevSwitcherUsersByRole,
} from "@/features/dev/dev-switcher-labels";
import { getErrorMessage } from "@/lib/error-message";

interface DevUserSwitcherProps {
  users: DevSwitcherUserRow[];
  currentUserId?: string;
  variant?: "menu" | "login";
}

export function DevUserSwitcher({
  users,
  currentUserId,
  variant = "menu",
}: DevUserSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSwitch = (userId: string) => {
    if (userId === currentUserId) return;

    startTransition(async () => {
      try {
        const { path } = await switchDevUser({ userId });
        toast.success("Usuario cambiado (dev)");
        router.push(path);
        router.refresh();
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  };

  if (users.length === 0) return null;

  const groups = groupDevSwitcherUsersByRole(users);
  const currentUser = users.find((user) => user.id === currentUserId);
  const currentUserLabel = currentUser
    ? formatDevSwitcherUserLabel(currentUser)
    : null;

  if (variant === "login") {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-amber-700 dark:text-amber-400" />
          <span className="text-sm font-medium">Acceso rápido (dev)</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            DEV
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Cambia de usuario sin contraseña para probar roles. Solo en entornos
          no productivos.
        </p>
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.role} className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {DEV_SWITCHER_ROLE_LABELS[group.role]}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.users.map((user) => (
                  <Button
                    key={user.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => onSwitch(user.id)}
                  >
                    {formatDevSwitcherUserLabel(user)}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-2 py-1">
      <div className="flex items-center gap-2 px-1">
        <Users className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Cambiar usuario</span>
        <Badge variant="outline" className="font-mono text-[10px]">
          DEV
        </Badge>
      </div>
      <Select
        value={currentUserId ?? ""}
        onValueChange={(userId) => {
          if (!userId) return;
          onSwitch(userId);
        }}
        disabled={pending}
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue placeholder="Seleccionar usuario…">
            {currentUserLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectGroup key={group.role}>
              <SelectLabel>{DEV_SWITCHER_ROLE_LABELS[group.role]}</SelectLabel>
              {group.users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {formatDevSwitcherUserLabel(user)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
