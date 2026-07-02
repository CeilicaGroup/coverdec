import { revalidatePath } from "next/cache";
import { ProjectKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export async function revalidateProjectSurfaces(
  projectId: string,
  lampId?: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { kind: true },
  });
  if (project?.kind === ProjectKind.STOCK) {
    revalidatePath("/dashboard/stock");
    if (lampId) revalidatePath(`/dashboard/stock/${lampId}`);
    return;
  }
  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${projectId}`);
}

export async function revalidateLampSurfaces(lampId: string): Promise<void> {
  const lamp = await prisma.lamp.findUnique({
    where: { id: lampId },
    select: { id: true, projectId: true },
  });
  if (!lamp) return;
  await revalidateProjectSurfaces(lamp.projectId, lamp.id);
}
