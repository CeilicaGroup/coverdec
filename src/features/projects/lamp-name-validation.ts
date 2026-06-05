import type { PrismaClient } from "@/generated/prisma";

export const LAMP_NAME_SIMILAR_PREFIX = "LAMP_NAME_SIMILAR:";

export type LampNameConflictLevel = "none" | "identical" | "similar";

export interface LampNameConflict {
  level: LampNameConflictLevel;
  matches: string[];
}

export function normalizeLampName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function lampNameFields(name: string): { name: string; nameKey: string } {
  const trimmed = name.trim();
  return {
    name: trimmed,
    nameKey: normalizeLampName(trimmed),
  };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i++) matrix[i]![0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return matrix[a.length]![b.length]!;
}

function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function isPrefixSimilarity(a: string, b: string): boolean {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 3) return false;
  if (!longer.startsWith(shorter)) return false;
  const suffix = longer.slice(shorter.length).trim();
  return suffix.length > 0 && suffix.length <= 4;
}

export function classifyLampNameConflict(
  name: string,
  existing: Array<{ id: string; name: string }>,
  excludeLampId?: string,
): LampNameConflict {
  const nameKey = normalizeLampName(name);
  if (!nameKey) {
    return { level: "none", matches: [] };
  }

  const others = existing.filter((lamp) => lamp.id !== excludeLampId);
  const identical = others.filter(
    (lamp) => normalizeLampName(lamp.name) === nameKey,
  );
  if (identical.length > 0) {
    return {
      level: "identical",
      matches: identical.map((lamp) => lamp.name),
    };
  }

  const similar = others.filter((lamp) => {
    const otherKey = normalizeLampName(lamp.name);
    if (!otherKey || otherKey === nameKey) return false;
    if (similarityRatio(nameKey, otherKey) >= 0.85) return true;
    return isPrefixSimilarity(nameKey, otherKey);
  });

  if (similar.length > 0) {
    return {
      level: "similar",
      matches: similar.map((lamp) => lamp.name),
    };
  }

  return { level: "none", matches: [] };
}

export function similarLampNameError(matches: string[]): Error {
  return new Error(`${LAMP_NAME_SIMILAR_PREFIX}${JSON.stringify(matches)}`);
}

export function parseSimilarLampNameError(message: string): string[] | null {
  if (!message.startsWith(LAMP_NAME_SIMILAR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(message.slice(LAMP_NAME_SIMILAR_PREFIX.length));
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : null;
  } catch {
    return null;
  }
}

export async function findLampNameConflicts(
  db: Pick<PrismaClient, "lamp">,
  args: {
    projectId: string;
    name: string;
    excludeLampId?: string;
  },
): Promise<LampNameConflict> {
  const lamps = await db.lamp.findMany({
    where: { projectId: args.projectId },
    select: { id: true, name: true },
  });
  return classifyLampNameConflict(args.name, lamps, args.excludeLampId);
}

export async function assertLampNameAllowed(
  db: Pick<PrismaClient, "lamp">,
  args: {
    projectId: string;
    name: string;
    excludeLampId?: string;
    confirmSimilarName?: boolean;
  },
): Promise<void> {
  const conflict = await findLampNameConflicts(db, args);

  if (conflict.level === "identical") {
    throw new Error(
      `Ya existe una lámpara llamada «${conflict.matches[0]}» en este proyecto.`,
    );
  }

  if (conflict.level === "similar" && !args.confirmSimilarName) {
    throw similarLampNameError(conflict.matches);
  }
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
