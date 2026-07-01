import { prisma } from "@/lib/db";

export async function loadActiveNavesOrdered(): Promise<
  { id: string; codigo: string; nombre: string }[]
> {
  return prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });
}

export async function loadActiveNaveIdsOrdered(): Promise<string[]> {
  const rows = await loadActiveNavesOrdered();
  return rows.map((n) => n.id);
}
