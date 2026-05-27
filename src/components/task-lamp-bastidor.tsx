import { cn } from "@/lib/utils";

export function TaskLampBastidor({
  label,
  className,
}: {
  label: string | null | undefined;
  className?: string;
}) {
  if (!label) return null;
  return (
    <div className={cn("text-[10px] text-muted-foreground truncate leading-tight", className)}>
      Bastidor: <span className="text-foreground/90">{label}</span>
    </div>
  );
}
