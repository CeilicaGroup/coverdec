"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { replacePersonNaves } from "@/features/people/person-naves";
import { Role } from "@/generated/prisma";
import { ensureDefaultSubscriptions } from "@/features/notifications/service";

const naveIdsSchema = z.array(z.string().min(1));

async function applyPersonNavesForUser(
  userId: string,
  role: Role,
  naveIds: string[],
) {
  if (role === Role.ADMIN) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personId: true },
  });
  if (!user?.personId) {
    throw new Error(
      "El usuario debe tener una persona de personal vinculada antes de asignar naves.",
    );
  }
  if (naveIds.length === 0) {
    throw new Error("Selecciona al menos una nave.");
  }
  await replacePersonNaves(user.personId, naveIds);
}

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  personId: z.string().optional(),
  naveIds: naveIdsSchema.optional(),
});

export async function createUser(input: z.infer<typeof createUserSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const data = createUserSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error("Ya existe un usuario con ese email.");

  await auth.api.signUpEmail({
    body: { name: data.name, email: data.email, password: data.password },
  });

  const user = await prisma.user.update({
    where: { email: data.email },
    data: {
      role: data.role,
      personId: data.personId ?? null,
      emailVerified: true,
    },
  });

  if (data.role !== Role.ADMIN && data.naveIds?.length) {
    await applyPersonNavesForUser(user.id, data.role, data.naveIds);
  }
  if (data.role === Role.ADMIN || data.role === Role.JEFE_PRODUCCION) {
    await ensureDefaultSubscriptions(user.id);
  }

  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard/personal");
}

const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.nativeEnum(Role),
  personId: z.string().optional().nullable(),
  naveIds: naveIdsSchema.optional(),
});

export async function updateUser(input: z.infer<typeof updateUserSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const data = updateUserSchema.parse(input);

  if (data.email) {
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existing && existing.id !== data.userId) {
      throw new Error("Ya existe un usuario con ese email.");
    }
  }

  await prisma.$transaction(async (tx) => {
    if (data.personId) {
      await tx.user.updateMany({
        where: { personId: data.personId, id: { not: data.userId } },
        data: { personId: null },
      });
    }
    await tx.user.update({
      where: { id: data.userId },
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        personId: data.personId ?? null,
      },
    });
  });

  if (data.role !== Role.ADMIN) {
    await applyPersonNavesForUser(
      data.userId,
      data.role,
      data.naveIds ?? [],
    );
  }
  if (data.role === Role.ADMIN || data.role === Role.JEFE_PRODUCCION) {
    await ensureDefaultSubscriptions(data.userId);
  }

  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard/personal");
}
