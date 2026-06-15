import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import {
  auditLogFiltersSchema,
  listAuditLogs,
  listDistinctAuditActions,
  listDistinctAuditEntityTypes,
  AUDIT_CATEGORIES,
} from "@/features/audit/queries";
import { TrazabilidadClient } from "./trazabilidad-client";

export default async function TrazabilidadAdminPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);

  const raw = (await searchParams) ?? {};
  const parsed = auditLogFiltersSchema.safeParse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    category: typeof raw.category === "string" ? raw.category : undefined,
    action: typeof raw.action === "string" ? raw.action : undefined,
    actorUserId: typeof raw.actorUserId === "string" ? raw.actorUserId : undefined,
    outcome:
      raw.outcome === "SUCCESS" || raw.outcome === "FAILURE" ? raw.outcome : undefined,
    entityType: typeof raw.entityType === "string" ? raw.entityType : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const filters = parsed.success ? parsed.data : auditLogFiltersSchema.parse({});
  const category = filters.category;

  const [result, users, actions, entityTypes] = await Promise.all([
    listAuditLogs(filters),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    listDistinctAuditActions(category),
    listDistinctAuditEntityTypes(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Trazabilidad"
        description={`${result.total.toLocaleString("es-ES")} eventos registrados · solo administradores`}
      />
      <TrazabilidadClient
        items={result.items}
        total={result.total}
        page={result.page}
        totalPages={result.totalPages}
        filters={filters}
        users={users}
        actions={actions}
        entityTypes={entityTypes}
        categories={[...AUDIT_CATEGORIES]}
      />
    </div>
  );
}
