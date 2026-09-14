import { cn } from "@/lib/utils";

export function Avatar({
  name,
  color,
  className,
  size = "md",
}: {
  name: string;
  color?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
  }[size];

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-inner",
        sizeClasses,
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${color ?? "var(--color-primary)"}, var(--color-accent))`,
      }}
    >
      {initials}
    </div>
  );
}
