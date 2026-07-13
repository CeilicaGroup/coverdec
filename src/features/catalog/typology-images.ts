import { prisma } from "@/lib/db";
import {
  buildTypologyImageAvailability,
  type TypologyImageAvailability,
} from "@/lib/typology-image";

export async function loadTypologyImageAvailability(): Promise<TypologyImageAvailability> {
  const rows = await prisma.elementTypologyNave.findMany({
    select: { typology: true, imageUpdatedAt: true },
  });
  return buildTypologyImageAvailability(rows);
}

export type { TypologyImageAvailability };
