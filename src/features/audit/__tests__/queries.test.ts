import { describe, expect, it } from "vitest";
import { buildAuditLogWhere } from "@/features/audit/queries";

describe("buildAuditLogWhere", () => {
  it("combines category, outcome and text search", () => {
    const where = buildAuditLogWhere({
      page: 1,
      category: "planning",
      outcome: "SUCCESS",
      q: "publicar",
    });

    expect(where).toEqual({
      category: "planning",
      outcome: "SUCCESS",
      OR: [
        { summary: { contains: "publicar", mode: "insensitive" } },
        { action: { contains: "publicar", mode: "insensitive" } },
        { actorEmail: { contains: "publicar", mode: "insensitive" } },
        { actorName: { contains: "publicar", mode: "insensitive" } },
        { entityId: { contains: "publicar", mode: "insensitive" } },
      ],
    });
  });

  it("builds inclusive UTC date range", () => {
    const where = buildAuditLogWhere({
      page: 2,
      from: "2026-06-01",
      to: "2026-06-15",
    });

    expect(where.createdAt).toEqual({
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lte: new Date("2026-06-15T23:59:59.999Z"),
    });
  });

  it("filters by actor and entity", () => {
    const where = buildAuditLogWhere({
      page: 1,
      actorUserId: "user-1",
      entityType: "Project",
      action: "projects.createProject",
    });

    expect(where).toEqual({
      actorUserId: "user-1",
      entityType: "Project",
      action: "projects.createProject",
    });
  });
});
