import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/error-message";

const DEFAULT_MUTATION_FALLBACK =
  "No se pudo completar la operación. Recarga la página si los datos no se actualizan.";

export function throwIfRedirect(error: unknown): never | void {
  if (isRedirectError(error)) throw error;
}

export function formatMutationError(
  error: unknown,
  fallback = DEFAULT_MUTATION_FALLBACK,
): string {
  return getErrorMessage(error, fallback);
}

/** Logs digest for server correlation and returns a user-facing message. */
export function reportMutationError(
  scope: string,
  error: unknown,
  fallback?: string,
): string {
  throwIfRedirect(error);

  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";

  console.error(`[mutation:${scope}]`, digest || "no-digest", error);
  return formatMutationError(error, fallback);
}

/** Prefer this when the server action returns ActionResult explicitly. */
export function handleActionResult<T>(
  scope: string,
  result: ActionResult<T>,
): { success: true; data: T } | { success: false; message: string } {
  if (result.ok) {
    return { success: true, data: result.data };
  }
  console.error(`[mutation:${scope}]`, result.error);
  return { success: false, message: result.error };
}

export type { ActionResult };
