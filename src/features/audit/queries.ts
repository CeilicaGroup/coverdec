import { z } from "zod";
import type { AuditOutcome, Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { AUDIT_CATEGORIES } from "@/lib/audit/categories";

const PAGE_SIZE = 50;

export const auditLogFiltersSchema = z.object({
  q: z.string().trim().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().optional(),
  action: z.string().optional(),
  actorUserId: z.string().optional(),
  outcome: z.enum(["SUCCESS", "FAILURE"]).optional(),
  entityType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;

export function buildAuditLogWhere(
  filters: AuditLogFilters,
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.category) {
    where.category = filters.category;
  }
  if (filters.action) {
    where.action = filters.action;
  }
  if (filters.actorUserId) {
    where.actorUserId = filters.actorUserId;
  }
  if (filters.outcome) {
    where.outcome = filters.outcome as AuditOutcome;
  }
  if (filters.entityType) {
    where.entityType = filters.entityType;
  }

  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) {
      where.createdAt.gte = new Date(`${filters.from}T00:00:00.000Z`);
    }
    if (filters.to) {
      where.createdAt.lte = new Date(`${filters.to}T23:59:59.999Z`);
    }
  }

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { action: { contains: q, mode: "insensitive" } },
      { actorEmail: { contains: q, mode: "insensitive" } },
      { actorName: { contains: q, mode: "insensitive" } },
      { entityId: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function listAuditLogs(filters: AuditLogFilters) {
  const parsed = auditLogFiltersSchema.parse(filters);
  const where = buildAuditLogWhere(parsed);
  const skip = (parsed.page - 1) * PAGE_SIZE;

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items,
    total,
    page: parsed.page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function listDistinctAuditActions(category?: string) {
  const rows = await prisma.auditLog.findMany({
    where: category ? { category } : undefined,
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
    take: 200,
  });
  return rows.map((row) => row.action);
}

export async function listDistinctAuditEntityTypes() {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: { not: null } },
    distinct: ["entityType"],
    select: { entityType: true },
    orderBy: { entityType: "asc" },
    take: 100,
  });
  return rows
    .map((row) => row.entityType)
    .filter((value): value is string => Boolean(value));
}

export { AUDIT_CATEGORIES, PAGE_SIZE };
