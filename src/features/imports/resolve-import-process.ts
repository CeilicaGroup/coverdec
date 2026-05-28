import { mapProcess } from "@/lib/excel/process-map";
import { PROCESS_CODE_PATTERN } from "@/types/process";
import { importSlug } from "./slug";

function processCodeFromLabel(label: string): string | null {
  const code = importSlug(label, 64).replace(/-/g, "_").toUpperCase();
  if (!code || !PROCESS_CODE_PATTERN.test(code)) return null;
  return code;
}

/** Resolves a catalog process code from an Excel label (known aliases or derived code). */
export function resolveImportProcessCode(processName: string): string | null {
  const trimmed = processName.trim();
  if (!trimmed) return null;
  return mapProcess(trimmed) ?? processCodeFromLabel(trimmed);
}
