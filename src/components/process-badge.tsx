import { cn } from "@/lib/utils";

export interface ProcessBadgeStyle {
  label: string;
  bgColor: string;
  fgColor: string;
  borderColor: string;
}

const NEUTRAL: ProcessBadgeStyle = {
  label: "",
  bgColor: "#F3F4F6",
  fgColor: "#374151",
  borderColor: "#9CA3AF",
};

export function ProcessBadge({
  code,
  definition,
  className,
}: {
  code: string;
  definition?: ProcessBadgeStyle | null;
  className?: string;
}) {
  const style = definition ?? { ...NEUTRAL, label: code };
  const label = style.label || code;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border-l-[3px]",
        className,
      )}
      style={{
        background: style.bgColor,
        color: style.fgColor,
        borderLeftColor: style.borderColor,
      }}
    >
      {label}
    </span>
  );
}

export function processColor(
  code: string,
  definition?: ProcessBadgeStyle | null,
): ProcessBadgeStyle {
  return definition ?? { ...NEUTRAL, label: code };
}
