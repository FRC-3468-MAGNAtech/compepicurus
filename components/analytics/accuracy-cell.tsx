"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import type { AccuracyResult } from "@/lib/scout-entries";

export function AccuracyCell({ accuracy }: { accuracy: AccuracyResult | null }) {
  const [open, setOpen] = useState(false);

  if (!accuracy || accuracy.status !== "complete" || accuracy.value === null) {
    return <span className="text-[var(--muted-foreground)]">-</span>;
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="cursor-help underline decoration-dotted decoration-[var(--muted-foreground)] underline-offset-4"
      >
        {Math.round(accuracy.value * 100)}%
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={springSnappy}
            className="glass-overlay absolute left-1/2 top-full z-50 mt-2 w-48 -translate-x-1/2 rounded-xl p-3 text-xs shadow-2xl"
          >
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Scouted total</span>
              <span className="font-medium">{accuracy.scoutedTotal}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Penalties</span>
              <span className="font-medium">{accuracy.penaltyPoints}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Official score</span>
              <span className="font-medium">{accuracy.officialScore}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
