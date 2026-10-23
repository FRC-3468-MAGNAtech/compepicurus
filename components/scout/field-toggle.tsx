"use client";

import { Check, Circle } from "lucide-react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function FieldToggle({
  label,
  pointsWhenOn,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  pointsWhenOn: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={springSnappy}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left transition-colors duration-200",
        checked
          ? "border-transparent text-white"
          : "glass-card border-[var(--glass-border)] text-[var(--foreground)]",
        disabled && "opacity-60 cursor-not-allowed"
      )}
      style={
        checked
          ? { background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }
          : undefined
      }
    >
      <div>
        <div className="text-base font-semibold">{label}</div>
        <div className={cn("text-xs", checked ? "text-white/80" : "text-[var(--muted-foreground)]")}>
          +{pointsWhenOn} pts when on
        </div>
      </div>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          checked ? "bg-white/20" : "bg-white/8"
        )}
      >
        {checked ? <Check className="h-5 w-5" /> : <Circle className="h-4 w-4 text-[var(--muted-foreground)]" />}
      </span>
    </motion.button>
  );
}
