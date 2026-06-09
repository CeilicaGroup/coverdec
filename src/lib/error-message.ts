const GENERIC_NEXT_ERROR_PATTERNS = [
  /An error occurred in the Server Components render/i,
  /An error occurred in the Server Functions/i,
  /An unexpected response was received from the server/i,
];

export const GENERIC_RSC_REFRESH_MESSAGE =
  "No se pudo refrescar la pantalla tras guardar. Recarga la página (F5). Si el problema continúa, revisa los logs del servidor (referencia digest en la consola del navegador).";

const ERROR_MESSAGE_TRANSLATIONS: Record<string, string> = {
  YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD:
    "No tienes permisos para cambiar la contraseña de otros usuarios.",
};

function isUsefulMessage(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return !GENERIC_NEXT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

function collectCandidates(error: unknown, depth = 0): string[] {
  if (depth > 4 || error == null) return [];

  if (typeof error === "string") return [error];
  if (typeof error === "number" || typeof error === "boolean") {
    return [String(error)];
  }

  if (error instanceof Error) {
    return [
      error.message,
      ...collectCandidates((error as { cause?: unknown }).cause, depth + 1),
    ];
  }

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const keysToCheck = [
      "message",
      "error",
      "detail",
      "title",
      "reason",
      "statusText",
      "body",
      "data",
      "cause",
      "errors",
    ] as const;

    return keysToCheck.flatMap((key) =>
      collectCandidates(record[key], depth + 1),
    );
  }

  return [];
}

export function getErrorMessage(error: unknown, fallback = "Error"): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && ERROR_MESSAGE_TRANSLATIONS[code]) {
      return ERROR_MESSAGE_TRANSLATIONS[code];
    }

    const bodyCode = (error as { body?: { code?: unknown } }).body?.code;
    if (
      typeof bodyCode === "string" &&
      ERROR_MESSAGE_TRANSLATIONS[bodyCode]
    ) {
      return ERROR_MESSAGE_TRANSLATIONS[bodyCode];
    }
  }

  const candidates = collectCandidates(error).map((candidate) =>
    candidate.trim(),
  );
  const useful = candidates.find(isUsefulMessage);
  if (useful) return useful;

  if (
    candidates.some((candidate) =>
      GENERIC_NEXT_ERROR_PATTERNS.some((pattern) => pattern.test(candidate)),
    )
  ) {
    return GENERIC_RSC_REFRESH_MESSAGE;
  }

  return fallback;
}
