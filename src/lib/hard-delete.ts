/** Hard delete is enabled unless explicitly disabled via env (default: on). */
export function isHardDeleteEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ALLOW_PROJECT_HARD_DELETE !== "false";
}
