import { parseSimilarLampNameError } from "@/features/projects/lamp-name-validation";

export function confirmSimilarLampName(matches: string[], action: "create" | "rename"): boolean {
  const quoted = matches.map((name) => `«${name}»`).join(", ");
  const verb = action === "create" ? "crear la lámpara" : "guardar el nombre";
  return globalThis.confirm(
    `Ya existe una lámpara con un nombre muy similar: ${quoted}.\n\n¿Quieres cambiar el nombre?\n\nPulsa Cancelar para editarlo o Aceptar para ${verb} igualmente.`,
  );
}

export async function withSimilarLampNameConfirmation<T>(
  action: "create" | "rename",
  submit: (confirmSimilarName: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await submit(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const matches = parseSimilarLampNameError(message);
    if (!matches?.length) throw error;
    if (!confirmSimilarLampName(matches, action)) {
      throw new Error("OPERATION_CANCELLED");
    }
    return submit(true);
  }
}

export function isOperationCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === "OPERATION_CANCELLED";
}
