"use client";

import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AllianceColor } from "@/lib/analytics/match-breakdown";

/**
 * The red/blue bar from the original Match Breakdown placeholder, grown into
 * both alliances: red fills from the left in proportion to its share of the two
 * scouted totals, blue takes the rest, animated with the shared spring. The
 * winning side glows; the other eases back. `fraction` null means there's
 * nothing honest to compare (an alliance unscouted, or withheld by the accuracy
 * filter), so the bar is an empty track rather than a guess.
 */
export function AllianceBar({
  fraction,
  winner,
  className,
}: {
  /** Red's share (0-1), or null for an empty track. */
  fraction: number | null;
  winner: AllianceColor | "tie" | null;
  className?: string;
}) {
  const redPct = fraction === null ? 0 : fraction * 100;
  const dim = (side: AllianceColor) => winner !== null && winner !== "tie" && winner !== side;

  return (
    <div className={cn("flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-white/8", className)} role="img" aria-label={fraction === null ? "No scouted comparison" : `Red ${Math.round(redPct)}% of scouted points`}>
      {fraction !== null && (
        <>
          <motion.div
            className={cn(
              "h-full rounded-full bg-gradient-to-r from-red-500 to-red-400 transition-opacity",
              winner === "red" && "shadow-[0_0_14px_rgba(248,113,113,0.65)]",
              dim("red") && "opacity-60"
            )}
            initial={false}
            animate={{ width: `${redPct}%` }}
            transition={spring}
          />
          <div
            className={cn(
              "h-full flex-1 rounded-full bg-gradient-to-l from-blue-500 to-blue-400 transition-opacity",
              winner === "blue" && "shadow-[0_0_14px_rgba(96,165,250,0.65)]",
              dim("blue") && "opacity-60"
            )}
          />
        </>
      )}
    </div>
  );
}
