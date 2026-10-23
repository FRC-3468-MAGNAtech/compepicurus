"use client";

import { Minus, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function CounterControl({
  label,
  pointsPer,
  value,
  onChange,
  disabled,
}: {
  label: string;
  pointsPer: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("glass-card flex items-center justify-between gap-3 p-4", disabled && "opacity-60")}>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-[var(--muted-foreground)]">{pointsPer} pts each</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <motion.button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled}
          whileTap={disabled ? undefined : { scale: 0.88 }}
          transition={springSnappy}
          onClick={() => onChange(Math.max(0, value - 1))}
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
          disabled={disabled}
          whileTap={disabled ? undefined : { scale: 0.88 }}
          transition={springSnappy}
          onClick={() => onChange(value + 1)}
          className="flex h-12 w-12 items-center justify-center rounded-full text-white disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
        >
          <Plus className="h-5 w-5" />
        </motion.button>
      </div>
    </div>
  );
}
