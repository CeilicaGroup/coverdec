import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/auth";
import { getDefaultDashboardPath } from "@/lib/dashboard-path";
import { prisma } from "@/lib/db";

async function requestHeaders() {
  return await headers();
}

export async function getSession() {
  const session = await auth.api.getSession({ headers: await requestHeaders() });
  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}

async function clearSessionCookie() {
  await auth.api.signOut({ headers: await requestHeaders() });
}

/** Session cookie can outlive a wiped DB; clear it so login does not loop on a missing User row. */
export async function redirectToLoginWithStaleSession(): Promise<never> {
  await clearSessionCookie();
  redirect("/login");
}

export async function requireSessionOrRedirect() {
  const hdrs = await requestHeaders();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) {
    if (getSessionCookie(hdrs)) await clearSessionCookie();
    redirect("/login");
  }
  return session;
}

/** Only redirect away from login when the session maps to a real User row (server truth). */
export async function redirectIfAuthenticated() {
  const session = await getSession();
  if (!session) return;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });
  if (user) redirect(getDefaultDashboardPath(user.role));

  await clearSessionCookie();
}
