import { AuditOutcome, type Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { resolveAuditCategory } from "@/lib/audit/categories";
import { getAuditRequestContext } from "@/lib/audit/request-context";
import { sanitizeAuditPayload } from "@/lib/audit/sanitize";
import type { AuditEventInput } from "@/lib/audit/types";

const log = childLogger({ module: "audit" });

function isAuditSelfAction(action: string): boolean {
  return action.startsWith("audit.");
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  if (isAuditSelfAction(input.action)) return;

  try {
    const ctx = getAuditRequestContext();
    const actor = input.actor ?? ctx?.actor ?? null;
    const request = input.request ?? ctx?.request ?? null;

    await prisma.auditLog.create({
      data: {
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.role ?? null,
        actorName: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
        action: input.action,
        category: input.category ?? resolveAuditCategory(input.action),
        outcome: input.outcome,
        naveId: input.naveId ?? actor?.naveId ?? null,
        ipAddress: request?.ipAddress ?? null,
        userAgent: request?.userAgent ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata: input.metadata
          ? (sanitizeAuditPayload(input.metadata) as Prisma.InputJsonValue)
          : undefined,
        changes: input.changes
          ? (sanitizeAuditPayload(input.changes) as Prisma.InputJsonValue)
          : undefined,
      },
    });
  } catch (error) {
    log.error({ err: error, action: input.action }, "failed to record audit event");
  }
}

export async function recordAuditSuccess(
  action: string,
  summary: string,
  extra?: Omit<AuditEventInput, "action" | "outcome" | "summary">,
): Promise<void> {
  await recordAuditEvent({
    action,
    summary,
    outcome: AuditOutcome.SUCCESS,
    ...extra,
  });
}

export async function recordAuditFailure(
  action: string,
  summary: string,
  extra?: Omit<AuditEventInput, "action" | "outcome" | "summary">,
): Promise<void> {
  await recordAuditEvent({
    action,
    summary,
    outcome: AuditOutcome.FAILURE,
    ...extra,
  });
}
