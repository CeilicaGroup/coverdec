import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditActor, AuditRequestMeta } from "@/lib/audit/types";

export interface AuditRequestContext {
  actor: AuditActor;
  request: AuditRequestMeta;
}

interface AuditContextSlot {
  current?: AuditRequestContext;
}

// Se guarda un objeto mutable: `enterWith` dentro de una función anidada (p. ej. requireDashboardContext)
// no siempre se ve desde quien la llamó, así que el wrapper abre el hueco y el contexto lo rellena.
const auditContextStorage = new AsyncLocalStorage<AuditContextSlot>();

export function runWithAuditContext<T>(
  context: AuditRequestContext,
  fn: () => T,
): T {
  return auditContextStorage.run({ current: context }, fn);
}

/** Abre un hueco de contexto para que el actor resuelto dentro de `fn` llegue a la auditoría. */
export function runWithAuditScope<T>(fn: () => T): T {
  return auditContextStorage.run({ current: getAuditRequestContext() }, fn);
}

export function setAuditRequestContext(context: AuditRequestContext): void {
  const slot = auditContextStorage.getStore();
  if (slot) slot.current = context;
  else auditContextStorage.enterWith({ current: context });
}

export function getAuditRequestContext(): AuditRequestContext | undefined {
  return auditContextStorage.getStore()?.current;
}
