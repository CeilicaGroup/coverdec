import { ZodError } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuditOutcome } from "@/generated/prisma";
import { actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { formatAuditActionLabel } from "@/lib/audit/categories";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AuditEventBuilder } from "@/lib/audit/types";
import { getErrorMessage } from "@/lib/error-message";
import { childLogger } from "@/lib/logger";

const log = childLogger({ module: "server-action" });

function defaultAuditSummary(scope: string): string {
  return formatAuditActionLabel(scope);
}

async function resolveAuditExtras<T>(
  audit: AuditEventBuilder<T> | undefined,
  result: T,
): Promise<Partial<import("@/lib/audit/types").AuditEventInput>> {
  if (!audit) return {};
  if (typeof audit === "function") return audit(result);
  return audit;
}

async function writeAuditSuccess<T>(
  scope: string,
  data: T,
  audit?: AuditEventBuilder<T>,
): Promise<void> {
  const extras = await resolveAuditExtras(audit, data);
  await recordAuditEvent({
    action: scope,
    outcome: AuditOutcome.SUCCESS,
    summary: extras.summary ?? defaultAuditSummary(scope),
    metadata: extras.metadata,
    changes: extras.changes,
    entityType: extras.entityType,
    entityId: extras.entityId,
    category: extras.category,
    naveId: extras.naveId,
  });
}

async function writeAuditFailure(scope: string, message: string): Promise<void> {
  await recordAuditEvent({
    action: scope,
    outcome: AuditOutcome.FAILURE,
    summary: `Error: ${message}`,
    metadata: { error: message },
  });
}

/**
 * Runs a mutation and records audit without wrapping the return value in ActionResult.
 */
export async function runAuditedMutation<T>(
  scope: string,
  handler: () => Promise<T>,
  audit?: AuditEventBuilder<T>,
): Promise<T> {
  try {
    const data = await handler();
    void writeAuditSuccess(scope, data, audit);
    return data;
  } catch (error) {
    if (isRedirectError(error)) throw error;
    log.error({ err: error, scope }, "audited mutation failed");
    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "Datos inválidos.")
        : getErrorMessage(error, "No se pudo completar la operación.");
    void writeAuditFailure(scope, message);
    throw error;
  }
}

/**
 * Runs a server action body and always returns a serializable result for the client.
 * Full errors are logged server-side; production never relies on Next.js masked messages.
 */
export async function runServerAction<T>(
  scope: string,
  handler: () => Promise<T>,
  audit?: AuditEventBuilder<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await handler();
    void writeAuditSuccess(scope, data, audit);
    return actionOk(data);
  } catch (error) {
    if (isRedirectError(error)) throw error;

    log.error({ err: error, scope }, "server action failed");

    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "Datos inválidos.")
        : getErrorMessage(error, "No se pudo completar la operación.");

    void writeAuditFailure(scope, message);

    if (error instanceof ZodError) {
      return actionFail(message);
    }

    return actionFail(message);
  }
}
