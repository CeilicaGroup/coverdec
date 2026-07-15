import { Role } from "@/generated/prisma";

export const DEV_SWITCHER_ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  JEFE_PRODUCCION: "Jefe de producción",
  OPERARIO: "Operario",
};

export function formatDevSwitcherUserLabel(user: {
  name: string;
  iniciales: string | null;
  role: Role;
}): string {
  const initials = user.iniciales ? ` (${user.iniciales})` : "";
  return `${user.name}${initials}`;
}

export function groupDevSwitcherUsersByRole<T extends { role: Role }>(
  users: T[],
): Array<{ role: Role; users: T[] }> {
  const order: Role[] = [Role.ADMIN, Role.JEFE_PRODUCCION, Role.OPERARIO];
  return order
    .map((role) => ({
      role,
      users: users.filter((user) => user.role === role),
    }))
    .filter((group) => group.users.length > 0);
}
