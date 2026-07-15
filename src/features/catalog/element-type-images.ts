import { prisma } from "@/lib/db";
import {
  buildElementTypeImageAvailability,
  type ElementTypeImageAvailability,
} from "@/lib/element-type-image";

export async function loadElementTypeImageAvailability(): Promise<ElementTypeImageAvailability> {
  const rows = await prisma.elementType.findMany({
    where: { imageUpdatedAt: { not: null } },
    select: { id: true, imageUpdatedAt: true },
  });
  return buildElementTypeImageAvailability(rows);
}

export type { ElementTypeImageAvailability };
