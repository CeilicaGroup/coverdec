import { createAuthEndpoint, APIError } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import { isDevUserSwitcherEnabled } from "@/lib/dev-user-switcher";

const devSwitchUserBodySchema = z.object({
  userId: z.string().min(1),
});

/** Passwordless session swap when the QA user switcher is enabled. */
export function devUserSwitchAuthPlugin() {
  return {
    id: "dev-user-switch",
    endpoints: {
      devSwitchUser: createAuthEndpoint(
        "/dev/switch-user",
        {
          method: "POST",
          body: devSwitchUserBodySchema,
          requireHeaders: true,
        },
        async (ctx) => {
          if (!isDevUserSwitcherEnabled()) {
            throw APIError.from("FORBIDDEN", {
              code: "DEV_SWITCHER_DISABLED",
              message: "El conmutador de usuario no está disponible.",
            });
          }

          const previousUserId = ctx.context.session?.user?.id ?? null;

          const sessionCookieToken = await ctx.getSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            ctx.context.secret,
          );
          if (sessionCookieToken) {
            try {
              await ctx.context.internalAdapter.deleteSession(sessionCookieToken);
            } catch {
              // Stale cookie; continue with a fresh session.
            }
          }
          deleteSessionCookie(ctx);

          const targetUser = await ctx.context.internalAdapter.findUserById(
            ctx.body.userId,
          );
          if (!targetUser) {
            throw APIError.from("NOT_FOUND", {
              code: "USER_NOT_FOUND",
              message: "Usuario no encontrado.",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            targetUser.id,
            false,
          );
          if (!session) {
            throw APIError.from("INTERNAL_SERVER_ERROR", {
              code: "FAILED_TO_CREATE_SESSION",
              message: "No se pudo iniciar sesión.",
            });
          }

          await setSessionCookie(ctx, { session, user: targetUser });

          return ctx.json({
            previousUserId,
            userId: targetUser.id,
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
