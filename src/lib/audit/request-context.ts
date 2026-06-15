import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditActor, AuditRequestMeta } from "@/lib/audit/types";

export interface AuditRequestContext {
  actor: AuditActor;
  request: AuditRequestMeta;
}

const auditContextStorage = new AsyncLocalStorage<AuditRequestContext>();

export function runWithAuditContext<T>(
  context: AuditRequestContext,
  fn: () => T,
): T {
  return auditContextStorage.run(context, fn);
}

export function setAuditRequestContext(context: AuditRequestContext): void {
  auditContextStorage.enterWith(context);
}

export function getAuditRequestContext(): AuditRequestContext | undefined {
  return auditContextStorage.getStore();
}
