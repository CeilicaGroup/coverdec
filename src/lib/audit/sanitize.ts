const SENSITIVE_KEY_PATTERN =
  /password|token|secret|authorization|cookie|accessToken|refreshToken|idToken|apiKey|credential/i;

const REDACTED = "[REDACTED]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeAuditPayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditPayload(item)) as T;
  }
  if (!isPlainObject(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = REDACTED;
      continue;
    }
    sanitized[key] = sanitizeAuditPayload(nested);
  }
  return sanitized as T;
}
