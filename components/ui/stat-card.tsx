"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cardEntranceVariants } from "@/lib/motion";

export function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  index = 0,
}: {
  label: string;
  value: string;
  delta?: string;
  icon?: LucideIcon;
  index?: number;
}) {
  return (
    <motion.div
      variants={cardEntranceVariants}
      initial="hidden"
      animate="show"
      custom={index}
    >
      <GlassPanel interactive className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {label}
          </span>
          {Icon && (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(var(--glow), 0.16)" }}
            >
              <Icon className="h-[18px] w-[18px]" style={{ color: "var(--color-primary)" }} />
            </span>
          )}
        </div>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {delta && <div className="text-xs text-[var(--muted-foreground)]">{delta}</div>}
      </GlassPanel>
    </motion.div>
  );
}
