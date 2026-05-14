import { ProcessCode } from "@/generated/prisma";
import { cn } from "@/lib/utils";

interface ProcessStyle {
  label: string;
  bg: string;
  fg: string;
  border: string;
}

const PROCESS_STYLES: Record<ProcessCode, ProcessStyle> = {
  CNC: { label: "CNC", bg: "#DBEAFE", fg: "#1D4ED8", border: "#1D4ED8" },
  ENSAMBLAJE: { label: "Ensamblaje", bg: "#DCFCE7", fg: "#15803D", border: "#15803D" },
  LIJADO: { label: "Lijado", bg: "#FEF9C3", fg: "#A16207", border: "#A16207" },
  IMPRIMACION: { label: "Imprimación", bg: "#FFEDD5", fg: "#C2410C", border: "#C2410C" },
  PINTURA: { label: "Pintura", bg: "#FEE2E2", fg: "#B91C1C", border: "#B91C1C" },
  PERFILES: { label: "Perfiles", bg: "#CCFBF1", fg: "#0F766E", border: "#0F766E" },
  EMBALAJE: { label: "Embalaje", bg: "#D1FAE5", fg: "#166534", border: "#166534" },
  PEGADO_ESPEJO: { label: "Pegado espejo", bg: "#EDE9FE", fg: "#5B21B6", border: "#5B21B6" },
  CORTE_MANUAL: { label: "Corte manual", bg: "#F3F4F6", fg: "#374151", border: "#374151" },
  LIMPIEZA: { label: "Limpieza", bg: "#E0F2FE", fg: "#0369A1", border: "#0369A1" },
};

export function ProcessBadge({
  code,
  className,
}: {
  code: ProcessCode;
  className?: string;
}) {
  const style = PROCESS_STYLES[code];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border-l-[3px]",
        className,
      )}
      style={{
        background: style.bg,
        color: style.fg,
        borderColor: style.border,
      }}
    >
      {style.label}
    </span>
  );
}

export function processColor(code: ProcessCode): ProcessStyle {
  return PROCESS_STYLES[code];
}
