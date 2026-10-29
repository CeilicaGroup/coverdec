import { prisma } from "@/lib/db";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";

export async function getNaves() {
  return prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
  });
}

export async function getAllNavesWithDetails() {
  const naves = await prisma.nave.findMany({
    orderBy: { codigo: "asc" },
    include: {
      personNaves: {
        select: {
          person: {
            select: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
      },
      tasks: {
        select: {
          id: true,
          process: true,
          estimatedHours: true,
          project: { select: { name: true, code: true } },
        },
      },
    },
  });
  const taskIds = naves.flatMap((nave) => nave.tasks.map((task) => task.id));
  const doneByTaskId = await loadDoneHoursByTaskIds(prisma, taskIds);
  return naves.map((nave) => ({
    ...nave,
    tasks: nave.tasks.map((task) => {
      const doneHours = doneByTaskId.get(task.id) ?? 0;
      return {
        ...task,
        pendingHours: Math.max(0, task.estimatedHours - doneHours),
      };
    }),
  }));
}
