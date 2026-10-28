import { expect, it } from "vitest";
import { AuditOutcome } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { buildWorld, loginAs } from "@/test/integration/world";
import { createFactoryItem, updateFactoryItem } from "@/features/factory/actions";

/** La auditoría se escribe con `void`: espera a que aparezcan las filas. */
async function auditRows(count: number) {
  for (let i = 0; i < 50; i++) {
    const rows = await prisma.auditLog.findMany({
      where: { action: { startsWith: "factory." } },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`esperaba ${count} filas de auditoría`);
}

it("cada acción auditada guarda quién la hizo, también al fallar, sin arrastrar al usuario anterior", async () => {
  const world = await buildWorld();

  await loginAs(world.users.admin.email);
  const item = await createFactoryItem({ product: "Lámpara hotel" });

  await loginAs(world.users.jefe.email);
  await expect(updateFactoryItem({ id: "no-existe" })).rejects.toThrow();

  const rows = await auditRows(2);
  expect(rows.map((r) => [r.action, r.outcome, r.actorUserId, r.actorRole])).toEqual([
    ["factory.createFactoryItem", AuditOutcome.SUCCESS, world.users.admin.id, "ADMIN"],
    ["factory.updateFactoryItem", AuditOutcome.FAILURE, world.users.jefe.id, "JEFE_PRODUCCION"],
  ]);
  expect(item).toBeTruthy();
});
