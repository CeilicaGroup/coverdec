import { beforeEach, describe, expect, it } from "vitest";
import { FactoryStatus } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { createFactoryItem, updateFactoryItem } from "@/features/factory/actions";
import { buildWorld, expectFail, loginAs, resetSession, unwrap, type World } from "@/test/integration/world";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
  await loginAs(world.users.jefe.email);
});

async function item(id: string) {
  return prisma.factoryItem.findUniqueOrThrow({ where: { id } });
}

describe("fábrica", () => {
  it("un ítem nuevo empieza en DOSSIER, sin fecha de envío, con los datos indicados", async () => {
    const created = unwrap(await createFactoryItem({ product: "Lámpara Hall", obra: "Hotel Sol", nave: "N1", code: "F-001" }));

    expect(await item(created.id)).toMatchObject({
      product: "Lámpara Hall",
      obra: "Hotel Sol",
      nave: "N1",
      code: "F-001",
      status: FactoryStatus.DOSSIER,
      shippedAt: null,
    });
  });

  it("recorre los estados; al pasar a ENVIADO fija la fecha de envío y la conserva en ediciones posteriores", async () => {
    const { id } = unwrap(await createFactoryItem({ product: "Aplique" }));

    for (const status of [FactoryStatus.PRODUCCION, FactoryStatus.CONTROL_CALIDAD, FactoryStatus.EMBALAJE]) {
      unwrap(await updateFactoryItem({ id, status }));
      const row = await item(id);
      expect(row.status).toBe(status);
      expect(row.shippedAt).toBeNull();
    }

    const before = Date.now();
    unwrap(await updateFactoryItem({ id, status: FactoryStatus.ENVIADO }));
    const shipped = await item(id);
    expect(shipped.status).toBe(FactoryStatus.ENVIADO);
    expect(shipped.shippedAt).not.toBeNull();
    expect(shipped.shippedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(shipped.shippedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // Editar notas después del envío no cambia ni el estado ni la fecha de envío.
    unwrap(await updateFactoryItem({ id, notes: "Entregado en obra" }));
    const edited = await item(id);
    expect(edited.notes).toBe("Entregado en obra");
    expect(edited.status).toBe(FactoryStatus.ENVIADO);
    expect(edited.shippedAt?.getTime()).toBe(shipped.shippedAt!.getTime());
  });

  it("una actualización parcial no borra los campos que no se envían", async () => {
    const { id } = unwrap(await createFactoryItem({ product: "Plafón", obra: "Obra X", nave: "N2", code: "F-9" }));
    unwrap(await updateFactoryItem({ id, notes: "nota", scheduledAt: "2026-11-10" }));

    unwrap(await updateFactoryItem({ id, status: FactoryStatus.PRODUCCION }));

    const row = await item(id);
    expect(row).toMatchObject({
      product: "Plafón",
      obra: "Obra X",
      nave: "N2",
      code: "F-9",
      notes: "nota",
      status: FactoryStatus.PRODUCCION,
    });
    expect(row.scheduledAt?.toISOString().slice(0, 10)).toBe("2026-11-10");
  });

  it("rechaza ítems sin producto, estados inválidos e ids inexistentes", async () => {
    expectFail(await createFactoryItem({ product: "" }));
    const { id } = unwrap(await createFactoryItem({ product: "Aplique" }));
    expectFail(await updateFactoryItem({ id, status: "PERDIDO" as FactoryStatus }));
    expectFail(await updateFactoryItem({ id: "no-existe", status: FactoryStatus.ENVIADO }));

    expect(await prisma.factoryItem.count()).toBe(1);
    expect((await item(id)).status).toBe(FactoryStatus.DOSSIER);
  });

  it("los operarios y las peticiones sin sesión no pueden crear ni cambiar ítems", async () => {
    const { id } = unwrap(await createFactoryItem({ product: "Aplique" }));

    await loginAs(world.users.ana.email);
    await expect(createFactoryItem({ product: "Otro" })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(updateFactoryItem({ id, status: FactoryStatus.ENVIADO })).rejects.toThrow(/NEXT_REDIRECT/);

    resetSession();
    await expect(updateFactoryItem({ id, status: FactoryStatus.ENVIADO })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await prisma.factoryItem.count()).toBe(1);
    expect(await item(id)).toMatchObject({ status: FactoryStatus.DOSSIER, shippedAt: null });

    // El admin sí.
    await loginAs(world.users.admin.email);
    unwrap(await updateFactoryItem({ id, status: FactoryStatus.PRODUCCION }));
    expect((await item(id)).status).toBe(FactoryStatus.PRODUCCION);
  });

  it("la fecha de envío existe solo mientras el ítem está ENVIADO", async () => {
    // Creado ya enviado: tiene fecha.
    const direct = unwrap(await createFactoryItem({ product: "Ya enviado", status: FactoryStatus.ENVIADO }));
    expect((await item(direct.id)).shippedAt).toBeInstanceOf(Date);

    const { id } = unwrap(await createFactoryItem({ product: "Aplique" }));
    unwrap(await updateFactoryItem({ id, status: FactoryStatus.ENVIADO }));
    const firstShippedAt = (await item(id)).shippedAt!;

    // Reenviar ENVIADO estando ya enviado no mueve la fecha.
    await new Promise((r) => setTimeout(r, 20));
    unwrap(await updateFactoryItem({ id, status: FactoryStatus.ENVIADO }));
    expect((await item(id)).shippedAt?.getTime()).toBe(firstShippedAt.getTime());

    // Volver atrás (p. ej. corregir un clic) la borra; al reenviar se fija de nuevo.
    unwrap(await updateFactoryItem({ id, status: FactoryStatus.EMBALAJE }));
    expect(await item(id)).toMatchObject({ status: FactoryStatus.EMBALAJE, shippedAt: null });
    unwrap(await updateFactoryItem({ id, status: FactoryStatus.ENVIADO }));
    expect((await item(id)).shippedAt).toBeInstanceOf(Date);
  });
});
