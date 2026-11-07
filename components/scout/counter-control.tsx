"use client";

import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function CounterControl({
  label,
  pointsPer,
  helpText,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  disabled,
  size = "md",
  icon,
}: {
  label: string;
  /** Points per tally; omitted (or 0) for a counter that doesn't score: the line then shows `helpText`, if any. */
  pointsPer?: number;
  helpText?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** P22: the field's `ui.size`. */
  size?: "sm" | "md" | "lg";
  /** P22: the field's `ui.icon`, shown before the label. */
  icon?: ReactNode;
}) {
  return (
    <div className={cn("glass-card flex items-center justify-between gap-3", size === "sm" ? "p-2" : size === "lg" ? "p-6" : "p-4", disabled && "opacity-60")}>
      <div className="min-w-0">
        <div className={cn("flex items-center gap-2 font-semibold", size === "lg" ? "text-base" : "text-sm")}>
          {icon}
          {label}
        </div>
        {(pointsPer || helpText) && <div className="text-xs text-[var(--muted-foreground)]">{pointsPer ? `${pointsPer} pts each` : helpText}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <motion.button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= min}
          whileTap={disabled ? undefined : { scale: 0.88 }}
          transition={springSnappy}
          onClick={() => onChange(Math.max(min, value - step))}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/8 text-[var(--foreground)] hover:bg-white/14 disabled:cursor-not-allowed"
        >
          <Minus className="h-5 w-5" />
        </motion.button>
        {/* Remounting via `key` replays the spring on every tap so rapid
            counting visibly pulses, without a second animation system
            fighting over the same transform. */}
        <motion.span
          key={value}
          initial={{ scale: 1.35 }}
          animate={{ scale: 1 }}
          transition={springSnappy}
          className="w-10 text-center text-2xl font-bold tabular-nums"
        >
          {value}
        </motion.span>
        <motion.button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled || (max !== undefined && value >= max)}
          whileTap={disabled ? undefined : { scale: 0.88 }}
          transition={springSnappy}
          onClick={() => onChange(max !== undefined ? Math.min(max, value + step) : value + step)}
          className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--color-primary-foreground)] disabled:cursor-not-allowed"
          style={{ background: "var(--theme-gradient)" }}
        >
          <Plus className="h-5 w-5" />
        </motion.button>
      </div>
    </div>
  );
}
