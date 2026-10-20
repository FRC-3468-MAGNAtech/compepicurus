"use client";

import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import type { ScoreBreakdown } from "@/lib/scout-entries";

export function ScoreBar({ score }: { score: ScoreBreakdown }) {
  return (
    <div className="glass-strong sticky bottom-3 z-20 mt-2 flex items-center justify-between gap-4 rounded-full px-5 py-3 shadow-2xl">
      <div className="flex gap-4 text-xs text-[var(--muted-foreground)]">
        <span>Auto {score.auto}</span>
        <span>Teleop {score.teleop}</span>
        <span>Endgame {score.endgame}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Total</span>
        <motion.span
          key={score.total}
          initial={{ scale: 1.25 }}
          animate={{ scale: 1 }}
          transition={springSnappy}
          className="text-xl font-bold tabular-nums text-gradient"
        >
          {score.total}
        </motion.span>
      </div>
    </div>
  );
}
