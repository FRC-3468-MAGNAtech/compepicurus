"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function CheckboxTile({
  label,
  checked,
  onChange,
  disabled,
  size = "md",
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** P22: the field's `ui.size`. */
  size?: "sm" | "md" | "lg";
  /** P22: the field's `ui.icon`, shown before the label. */
  icon?: ReactNode;
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
        "relative flex items-center gap-2 rounded-2xl border px-4 text-sm font-medium transition-colors duration-200",
        size === "sm" ? "py-1.5" : size === "lg" ? "py-5 text-base" : "py-3",
        checked
          ? "border-transparent text-[var(--color-primary-foreground)]"
          : "glass-card border-[var(--glass-border)] text-[var(--muted-foreground)]",
        disabled && "opacity-60 cursor-not-allowed"
      )}
      style={
        checked
          ? { background: "var(--theme-gradient)" }
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
      {icon}
      {label}
    </motion.button>
  );
}
