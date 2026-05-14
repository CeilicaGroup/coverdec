import { cn } from "@/lib/utils";

export function PersonAvatar({
  iniciales,
  color,
  size = 26,
  className,
}: {
  iniciales: string;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold text-white",
        className,
      )}
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: size * 0.38,
      }}
    >
      {iniciales}
    </span>
  );
}
