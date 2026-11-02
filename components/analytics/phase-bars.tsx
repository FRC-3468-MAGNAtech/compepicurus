"use client";

import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Auto / Teleop / Endgame bars (P11). The three colours are fixed CSS
// variables (see globals.css) — categorical slots 1-3 of the dataviz palette,
// validated together on both theme surfaces. Segments are separated by a 2px
// gap and every value is also written out as text, so identity is never
// colour-alone.

export const PHASES = [
  { key: "auto", label: "Auto", full: "Autonomous", color: "var(--phase-auto)" },
  { key: "teleop", label: "Teleop", full: "Teleoperated", color: "var(--phase-teleop)" },
  { key: "endgame", label: "Endgame", full: "Endgame", color: "var(--phase-endgame)" },
] as const;

export type PhaseValues = { auto: number; teleop: number; endgame: number };

/** Line-key legend: a short stroke of each phase colour beside its name. */
export function PhaseLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]", className)}>
      {PHASES.map((p) => (
        <span key={p.key} className="flex items-center gap-1.5">
          <span aria-hidden className="h-1 w-4 rounded-full" style={{ background: p.color }} />
          {p.full}
        </span>
      ))}
    </div>
  );
}

/**
 * One stacked bar for one robot's score: the whole bar's length is
 * `total / scaleMax` (so bars in the same match compare with each other), split
 * by phase. The numbers sit underneath as text.
 */
export function PhaseStackedBar({ auto, teleop, endgame, scaleMax }: PhaseValues & { scaleMax: number }) {
  const total = auto + teleop + endgame;
  const widthPct = scaleMax > 0 ? Math.min(100, (total / scaleMax) * 100) : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/8" role="img" aria-label={`Autonomous ${auto}, teleop ${teleop}, endgame ${endgame}`}>
        <motion.div className="flex h-full gap-0.5" initial={false} animate={{ width: `${widthPct}%` }} transition={spring}>
          {PHASES.map((p) => {
            const v = p.key === "auto" ? auto : p.key === "teleop" ? teleop : endgame;
            return v > 0 ? <span key={p.key} className="h-full rounded-full" style={{ flexGrow: v, flexBasis: 0, background: p.color }} /> : null;
          })}
        </motion.div>
      </div>
      <div className="flex gap-3 text-[11px] tabular-nums text-[var(--muted-foreground)]">
        {PHASES.map((p) => (
          <span key={p.key} className="flex items-center gap-1">
            <span aria-hidden className="h-0.5 w-2 rounded-full" style={{ background: p.color }} />
            {p.label.charAt(0)} <strong className="font-medium text-[var(--foreground)]">{p.key === "auto" ? auto : p.key === "teleop" ? teleop : endgame}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Three thin bars (auto / teleop / endgame averages), each scaled to the best team's value for that phase. */
export function PhaseMiniBars({ values, max }: { values: PhaseValues; max: PhaseValues }) {
  return (
    <div className="flex flex-col gap-1.5">
      {PHASES.map((p) => {
        const v = values[p.key];
        const pct = max[p.key] > 0 ? Math.min(100, (v / max[p.key]) * 100) : 0;
        return (
          <div key={p.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-[var(--muted-foreground)]">{p.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8" aria-hidden>
              <motion.span className="block h-full rounded-full" initial={false} animate={{ width: `${pct}%` }} transition={spring} style={{ background: p.color }} />
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums">{v.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}
