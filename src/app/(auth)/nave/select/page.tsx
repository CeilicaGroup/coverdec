import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSessionOrRedirect } from "@/lib/auth-server";
import { getDefaultDashboardPath } from "@/lib/dashboard-path";
import { NaveSelectClient } from "./nave-select-client";

export default async function NaveSelectPage() {
  const session = await requireSessionOrRedirect();

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(getDefaultDashboardPath(user.role));

  const naves = await prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
  });

  return <NaveSelectClient naves={naves.map((n) => ({ id: n.id, codigo: n.codigo, nombre: n.nombre }))} />;
}
