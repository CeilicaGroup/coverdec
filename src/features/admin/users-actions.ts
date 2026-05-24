"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  naveId: z.string().optional().nullable(),
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

  await prisma.user.update({
    where: { email: data.email },
    data: {
      role: data.role,
      naveId: data.naveId ?? null,
      emailVerified: true,
    },
  });

  revalidatePath("/dashboard/admin/usuarios");
}

const updateUserSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(Role),
  naveId: z.string().optional().nullable(),
});

export async function updateUser(input: z.infer<typeof updateUserSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const data = updateUserSchema.parse(input);

  await prisma.user.update({
    where: { id: data.userId },
    data: {
      role: data.role,
      naveId: data.naveId ?? null,
    },
  });

  revalidatePath("/dashboard/admin/usuarios");
}
