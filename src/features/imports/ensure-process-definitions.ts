import type { Prisma } from "@/generated/prisma";
import { processColorsForCode } from "@/lib/color";

export interface ProcessEnsureResult {
  created: number;
}

/** Creates missing process definitions; existing rows are left unchanged (idempotent). */
export async function ensureProcessDefinitions(
  tx: Prisma.TransactionClient,
  items: Array<{ code: string; label: string }>,
): Promise<ProcessEnsureResult> {
  if (items.length === 0) return { created: 0 };

  const codes = [...new Set(items.map((i) => i.code))];
  const existing = await tx.processDefinition.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((p) => p.code));

  const byCode = new Map(items.map((i) => [i.code, i.label.trim() || i.code]));

  let created = 0;
  for (const code of codes) {
    if (existingCodes.has(code)) continue;
    const label = byCode.get(code) ?? code;
    const colors = processColorsForCode(code);
    await tx.processDefinition.create({
      data: {
        code,
        label,
        factor: 1,
        setupHours: 0,
        waitHours: 0,
        canFragment: true,
        ...colors,
      },
    });
    created += 1;
  }

  return { created };
}
