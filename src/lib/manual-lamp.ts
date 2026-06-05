import type { ProcessCode } from "@/types/process";

export const MANUAL_ESTIMATION_PROCESS = "ESTIMACION_MANUAL" as ProcessCode;

export function isManualEstimateLamp(lamp: {
  elementTypeId: string | null;
  tasks: Array<{ process: string }>;
}): boolean {
  return (
    lamp.elementTypeId == null ||
    lamp.tasks.some((task) => task.process === MANUAL_ESTIMATION_PROCESS)
  );
}
