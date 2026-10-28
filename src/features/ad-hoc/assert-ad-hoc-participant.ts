import { Role, TaskSystemKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export const AD_HOC_NOT_PARTICIPANT_ERROR =
  "Solo los operarios asignados a esta imprevista pueden fichar o completarla.";

/**
 * Un operario solo puede fichar o completar las imprevistas en las que participa.
 * Admin y jefe de producción pueden registrar en nombre de otros, como en el resto de tareas.
 */
export async function assertCanWorkOnAdHocTask(
  ctx: { role: Role; personId: string | null },
  taskId: string,
): Promise<void> {
  if (ctx.role !== Role.OPERARIO) return;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      systemKind: true,
      participants: { where: { personId: ctx.personId ?? "" }, select: { personId: true } },
    },
  });
  if (task?.systemKind !== TaskSystemKind.AD_HOC) return;
  if (task.participants.length === 0) throw new Error(AD_HOC_NOT_PARTICIPANT_ERROR);
}
