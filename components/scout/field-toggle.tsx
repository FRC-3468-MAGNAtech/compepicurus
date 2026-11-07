"use client";

import { Check, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function FieldToggle({
  label,
  pointsWhenOn,
  helpText,
  checked,
  onChange,
  disabled,
  size = "md",
  icon,
}: {
  label: string;
  /** Points when on; omitted (or 0) for a toggle that doesn't score: the line then shows `helpText`, if any. */
  pointsWhenOn?: number;
  helpText?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** P22: the field's `ui.size` (small / medium / large touch target). */
  size?: "sm" | "md" | "lg";
  /** P22: the field's `ui.icon`, shown before the label. */
  icon?: ReactNode;
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
        "flex w-full items-center justify-between gap-3 rounded-2xl border px-5 text-left transition-colors duration-200",
        size === "sm" ? "py-2" : size === "lg" ? "py-6" : "py-4",
        checked
          ? "border-transparent text-[var(--color-primary-foreground)]"
          : "glass-card border-[var(--glass-border)] text-[var(--foreground)]",
        disabled && "opacity-60 cursor-not-allowed"
      )}
      style={
        checked
          ? { background: "var(--theme-gradient)" }
          : undefined
      }
    >
      <div>
        <div className={cn("flex items-center gap-2 font-semibold", size === "lg" ? "text-lg" : "text-base")}>
          {icon}
          {label}
        </div>
        {(pointsWhenOn || helpText) && (
          <div className={cn("text-xs", checked ? "text-[var(--color-primary-foreground)] opacity-80" : "text-[var(--muted-foreground)]")}>
            {pointsWhenOn ? `+${pointsWhenOn} pts when on` : helpText}
          </div>
        )}
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
