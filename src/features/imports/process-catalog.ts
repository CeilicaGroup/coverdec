import { prisma } from "@/lib/db";

export async function loadValidProcessCodes(): Promise<Set<string>> {
  const definitions = await prisma.processDefinition.findMany({
    select: { code: true },
  });
  return new Set(definitions.map((d) => d.code));
}

export function isProcessInCatalog(
  code: string | null | undefined,
  validCodes: Set<string>,
): boolean {
  return code != null && code.length > 0 && validCodes.has(code);
}
