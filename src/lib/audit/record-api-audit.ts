import { AuditOutcome } from "@/generated/prisma";
import { requireDashboardContext } from "@/lib/context";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AuditEventInput } from "@/lib/audit/types";

function requestMetaFromHeaders(request: Request) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.headers.get("x-real-ip")
      ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}

export async function recordApiAudit(
  action: string,
  request: Request,
  outcome: AuditOutcome,
  summary: string,
  extra?: Omit<AuditEventInput, "action" | "outcome" | "summary" | "request">,
): Promise<void> {
  const requestMeta = requestMetaFromHeaders(request);

  try {
    const ctx = await requireDashboardContext();
    await recordAuditEvent({
      action,
      outcome,
      summary,
      category: "api",
      request: requestMeta,
      actor: {
        userId: ctx.userId,
        role: ctx.role,
        name: ctx.name,
        email: ctx.email,
        naveId: ctx.naveId,
      },
      naveId: ctx.naveId,
      ...extra,
    });
  } catch (error) {
    await recordAuditEvent({
      action,
      outcome,
      summary,
      category: "api",
      request: requestMeta,
      metadata: {
        error: error instanceof Error ? error.message : "unknown",
      },
      ...extra,
    });
  }
}
