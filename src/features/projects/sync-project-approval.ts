import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { deriveProjectApprovalStatus } from "@/lib/project-approval";

export async function syncProjectApprovalStatus(
  projectId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const lamps = await tx.lamp.findMany({
    where: { projectId },
    select: { isApprovedForPlanning: true },
  });
  const approvalStatus = deriveProjectApprovalStatus(
    lamps.map((lamp) => lamp.isApprovedForPlanning),
  );
  await tx.project.update({
    where: { id: projectId },
    data: { approvalStatus },
  });
  return approvalStatus;
}
