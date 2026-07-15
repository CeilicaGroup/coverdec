/** QA user switcher; opt-in outside development via ENABLE_DEV_USER_SWITCHER. */
export function isDevUserSwitcherEnabled(): boolean {
  if (process.env.ENABLE_DEV_USER_SWITCHER === "true") return true;
  return process.env.NODE_ENV === "development";
}

export function assertDevUserSwitcherEnabled(): void {
  if (!isDevUserSwitcherEnabled()) {
    throw new Error("El conmutador de usuario no está disponible.");
  }
}
