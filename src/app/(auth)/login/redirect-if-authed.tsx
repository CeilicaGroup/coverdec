"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Si ya hay sesión válida (validada por el cliente), no mostrar el login.
 * Esto evita un bucle 307 con el proxy: cookie presente pero sesión inválida en servidor
 * hacía que el proxy enviara /login → /dashboard y el layout /dashboard → /login.
 */
export function RedirectIfAuthed() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const to = params.get("redirect") ?? "/dashboard";
    router.replace(to);
  }, [session, isPending, router]);

  return null;
}
