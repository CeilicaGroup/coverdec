import { ZodError } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/error-message";
import { childLogger } from "@/lib/logger";

const log = childLogger({ module: "server-action" });

/**
 * Runs a server action body and always returns a serializable result for the client.
 * Full errors are logged server-side; production never relies on Next.js masked messages.
 */
export async function runServerAction<T>(
  scope: string,
  handler: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await handler();
    return actionOk(data);
  } catch (error) {
    if (isRedirectError(error)) throw error;

    log.error({ err: error, scope }, "server action failed");

    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Datos inválidos.";
      return actionFail(message);
    }

    return actionFail(
      getErrorMessage(error, "No se pudo completar la operación."),
    );
  }
}
