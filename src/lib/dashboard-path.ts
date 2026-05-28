import { Role } from "@/generated/prisma";

/** Landing route after login; operarios must not use Resumen. */
export function getDefaultDashboardPath(role: Role): string {
  if (role === Role.OPERARIO) return "/dashboard/horas";
  return "/dashboard";
}

export function resolvePostLoginPath(
  role: Role | undefined,
  redirectParam: string | null,
): string {
  const fallback = getDefaultDashboardPath(role ?? Role.OPERARIO);
  if (!redirectParam?.startsWith("/dashboard")) return fallback;
  if (
    role === Role.OPERARIO &&
    (redirectParam === "/dashboard" || redirectParam === "/dashboard/")
  ) {
    return fallback;
  }
  return redirectParam;
}
