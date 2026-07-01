"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { assertSingleNaveId, setPersonNave } from "@/features/people/person-naves";
import { Role } from "@/generated/prisma";
import { ensureDefaultSubscriptions } from "@/features/notifications/service";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";

const operarioNaveIdsSchema = z.array(z.string().min(1)).length(1);

async function applyPersonNaveForUser(
  userId: string,
  role: Role,
  naveIds: string[],
) {
  if (role === Role.ADMIN || role === Role.JEFE_PRODUCCION) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personId: true },
  });
  if (!user?.personId) {
    throw new Error(
      "El usuario debe tener una persona de personal vinculada antes de asignar naves.",
    );
  }
  const naveId = assertSingleNaveId(naveIds);
  await setPersonNave(user.personId, naveId);
}

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  naveIds: operarioNaveIdsSchema.optional(),
});

export async function createUser(
  input: z.infer<typeof createUserSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("admin.createUser", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const data = createUserSchema.parse(input);

    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) throw new Error("Ya existe un usuario con ese email.");

    await auth.api.signUpEmail({
      body: { name: data.name, email: data.email, password: data.password },
    });

    const user = await prisma.user.update({
      where: { email: data.email },
      data: {
        role: data.role,
        emailVerified: true,
      },
    });

    if (data.role === Role.OPERARIO && data.naveIds?.length) {
      await applyPersonNaveForUser(user.id, data.role, data.naveIds);
    }
    if (data.role === Role.ADMIN || data.role === Role.JEFE_PRODUCCION) {
      await ensureDefaultSubscriptions(user.id);
    }

    revalidatePath("/dashboard/admin/usuarios");
    revalidatePath("/dashboard/personal");
  });
}

const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.nativeEnum(Role),
  naveIds: operarioNaveIdsSchema.optional(),
});

export async function updateUser(
  input: z.infer<typeof updateUserSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("admin.updateUser", async () => {
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

    await prisma.user.update({
      where: { id: data.userId },
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
      },
    });

    if (data.password) {
      await auth.api.setUserPassword({
        body: {
          userId: data.userId,
          newPassword: data.password,
        },
        headers: await headers(),
      });
    }

    if (data.role === Role.OPERARIO) {
      await applyPersonNaveForUser(
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
  });
}
