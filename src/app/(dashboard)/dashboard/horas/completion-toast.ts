/**
 * Texto del aviso al dar tareas por terminadas. Si alguna solo quedó firmada por esta persona
 * (tareas «firman todos»), no se dice «completada»: falta que firmen los demás operarios.
 */
export function completionToast(signedOnly: number, completedText: string): string {
  if (signedOnly <= 0) return completedText;
  return signedOnly === 1
    ? "Registro guardado y firmado. La tarea se cerrará cuando la firmen también los demás operarios."
    : `Registro guardado y firmado en ${signedOnly} tareas. Se cerrarán cuando las firmen también los demás operarios.`;
}
