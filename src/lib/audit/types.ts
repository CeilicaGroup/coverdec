import type { AuditOutcome, Role } from "@/generated/prisma";

export interface AuditActor {
  userId: string;
  role: Role;
  name: string;
  email: string;
  naveId: string | null;
}

export interface AuditRequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditEventInput {
  action: string;
  category?: string;
  outcome: AuditOutcome;
  summary: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  changes?: { before?: unknown; after?: unknown };
  actor?: AuditActor | null;
  request?: AuditRequestMeta;
  naveId?: string | null;
}

export type AuditEventBuilder<T> =
  | Partial<AuditEventInput>
  | ((result: T) => Partial<AuditEventInput> | Promise<Partial<AuditEventInput>>);
