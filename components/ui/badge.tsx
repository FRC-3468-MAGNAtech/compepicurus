import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      variant: {
        accent:
          "text-[var(--color-primary-foreground)] bg-[linear-gradient(135deg,var(--color-primary),var(--color-accent))]",
        glass: "glass-pill text-[var(--foreground)]",
        outline: "border border-[var(--glass-border)] text-[var(--muted-foreground)]",
        success: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30",
        warning: "bg-amber-500/15 text-amber-300 border border-amber-400/30",
        danger: "bg-red-500/15 text-red-300 border border-red-400/30",
      },
    },
    defaultVariants: { variant: "glass" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
