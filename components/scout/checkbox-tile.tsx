"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function CheckboxTile({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={spring}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors duration-200",
        checked
          ? "border-transparent text-white"
          : "glass-card border-[var(--glass-border)] text-[var(--muted-foreground)]",
        disabled && "opacity-60 cursor-not-allowed"
      )}
      style={
        checked
          ? { background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }
          : undefined
      }
    >
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
          checked ? "border-white/40 bg-white/20" : "border-[var(--glass-border)]"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      {label}
    </motion.button>
  );
}
