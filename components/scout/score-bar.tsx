"use client";

import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import type { ScoreBreakdown } from "@/lib/scout-entries";

/** The sticky score bar. `phases` lists the phase subtotals to show (default Auto / Teleop / Endgame, as ever); a custom-phase form passes its own. */
export function ScoreBar({ score, phases }: { score: ScoreBreakdown; phases?: { label: string; value: number }[] }) {
  const shown = phases ?? [
    { label: "Auto", value: score.auto },
    { label: "Teleop", value: score.teleop },
    { label: "Endgame", value: score.endgame },
  ];
  return (
    <div className="glass-strong sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mt-2 flex items-center justify-between gap-4 rounded-full px-5 py-3 shadow-2xl">
      <div className="flex gap-4 overflow-x-auto text-xs text-[var(--muted-foreground)]">
        {shown.map((p) => (
          <span key={p.label} className="shrink-0">
            {p.label} {p.value}
          </span>
        ))}
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
