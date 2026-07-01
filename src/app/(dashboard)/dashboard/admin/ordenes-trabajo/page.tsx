import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import { getProcessBadgeStylesByCode } from "@/features/planning/queries";
import { loadAssigneeByTaskIds } from "@/features/work-orders/display-context";
import {
  listEligibleTasksForWorkOrder,
  listWorkOrders,
  workOrdersHavePlanningAssignments,
  workOrdersHaveTimeEntries,
} from "@/features/work-orders/queries";
import { OrdenesTrabajoClient } from "./ordenes-trabajo-client";

export default async function OrdenesTrabajoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const { status: statusParam } = await searchParams;
  const statusFilter =
    statusParam === "ALL"
      ? "ALL"
      : statusParam === "CLOSED"
        ? "CLOSED"
        : "OPEN";

  const [workOrders, eligibleTasks, processStyles] = await Promise.all([
    listWorkOrders(statusFilter),
    listEligibleTasksForWorkOrder(),
    getProcessBadgeStylesByCode(),
  ]);

  const taskIds = workOrders.flatMap((order) => order.tasks.map((t) => t.id));
  const assigneeByTaskId = await loadAssigneeByTaskIds(taskIds);
  const workOrderIds = workOrders.map((order) => order.id);
  const [workOrderIdsWithTimeEntries, workOrderIdsWithPlanningAssignments] =
    await Promise.all([
      workOrdersHaveTimeEntries(workOrderIds),
      workOrdersHavePlanningAssignments(workOrderIds),
    ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Órdenes de trabajo"
        description="Agrupa tareas para que el planificador las asigne al mismo operario en secuencia"
      />
      <OrdenesTrabajoClient
        workOrders={workOrders}
        eligibleTasks={eligibleTasks}
        statusFilter={statusFilter}
        assigneeByTaskId={Object.fromEntries(assigneeByTaskId)}
        processStylesByCode={Object.fromEntries(processStyles)}
        workOrderIdsWithTimeEntries={[...workOrderIdsWithTimeEntries]}
        workOrderIdsWithPlanningAssignments={[
          ...workOrderIdsWithPlanningAssignments,
        ]}
      />
    </div>
  );
}
