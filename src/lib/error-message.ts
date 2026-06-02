const GENERIC_NEXT_ERROR_PATTERNS = [
  /An error occurred in the Server Components render/i,
  /An error occurred in the Server Functions/i,
  /An unexpected response was received from the server/i,
];

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
  const candidates = collectCandidates(error).map((candidate) =>
    candidate.trim(),
  );
  const useful = candidates.find(isUsefulMessage);
  return useful ?? fallback;
}
