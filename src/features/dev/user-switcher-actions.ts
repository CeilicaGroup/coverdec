"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/auth-server";
import { setAuditRequestContext } from "@/lib/audit/request-context";
import type { AuditEventInput } from "@/lib/audit/types";
import { getDefaultDashboardPath } from "@/lib/dashboard-path";
import { prisma } from "@/lib/db";
import { assertDevUserSwitcherEnabled } from "@/lib/dev-user-switcher";
import { childLogger } from "@/lib/logger";
import { runServerAction } from "@/lib/server-action";

const log = childLogger({ module: "dev.user-switcher" });

async function requestHeaders() {
  return await headers();
}

function revalidateDashboardPaths() {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/login");
}

const switchDevUserSchema = z.object({
  userId: z.string().min(1),
});

export async function switchDevUser(
  input: z.infer<typeof switchDevUserSchema>,
): Promise<ActionResult<{ path: string }>> {
  let audit: Partial<AuditEventInput> = {};
  return runServerAction(
    "dev.userSwitch",
    async () => {
      assertDevUserSwitcherEnabled();
      const { userId } = switchDevUserSchema.parse(input);

      const target = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true },
      });
      if (!target) throw new Error("Usuario no encontrado.");

      const hdrs = await requestHeaders();
      const currentSession = await getSession();
      const previousUserId = currentSession?.user.id ?? null;

      const result = await auth.api.devSwitchUser({
        body: { userId: target.id },
        headers: hdrs,
      });

      // La auditoría se atribuye al usuario destino, con la IP/UA de esta petición.
      setAuditRequestContext({
        actor: {
          userId: target.id,
          role: target.role,
          name: target.name,
          email: target.email,
          naveId: null,
        },
        request: {
          ipAddress:
            hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? hdrs.get("x-real-ip")
            ?? null,
          userAgent: hdrs.get("user-agent"),
        },
      });
      audit = {
        category: "auth",
        summary: `Cambio de usuario dev → ${target.name}`,
        entityType: "User",
        entityId: target.id,
        metadata: {
          previousUserId: result.previousUserId ?? previousUserId,
          targetUserId: target.id,
          targetRole: target.role,
        },
      };

      log.info(
        {
          previousUserId: result.previousUserId ?? previousUserId,
          targetUserId: target.id,
          targetRole: target.role,
        },
        "dev user switch",
      );

      revalidateDashboardPaths();

      return { path: getDefaultDashboardPath(target.role) };
    },
    () => audit,
  );
}
