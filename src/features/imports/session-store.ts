const TTL_MS = 30 * 60 * 1000;

interface SessionEntry {
  buffer: Buffer;
  createdAt: number;
}

const sessions = new Map<string, SessionEntry>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.createdAt > TTL_MS) sessions.delete(id);
  }
}

export function createImportSession(buffer: Buffer): string {
  purgeExpired();
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { buffer, createdAt: Date.now() });
  return sessionId;
}

export function getImportSessionBuffer(sessionId: string): Buffer | null {
  purgeExpired();
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return entry.buffer;
}

export function deleteImportSession(sessionId: string): void {
  sessions.delete(sessionId);
}
