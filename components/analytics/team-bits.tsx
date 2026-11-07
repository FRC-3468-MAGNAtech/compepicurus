"use client";

import { AlertTriangle, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { cn } from "@/lib/utils";

/**
 * P19: one shared way to mark "this is one of our FTC teams" (any team on the account, not just the one
 * being viewed as): a small filled "Us" tag and a tinted row/card. The tag uses the theme's accent fill
 * and its guarded on-accent text colour, so it stays legible in every theme.
 */
export const OUR_TEAM_ROW_CLASS = "bg-[rgba(var(--glow),0.14)] shadow-[inset_3px_0_0_0_var(--color-primary)]";

export function OurTeamTag({ className }: { className?: string }) {
  return (
    <Badge variant="accent" className={cn("gap-1 px-2 py-0.5 text-[10px] font-semibold", className)} title="One of our FTC teams">
      <Star className="h-2.5 w-2.5" aria-hidden /> Us<span className="sr-only"> (one of our FTC teams)</span>
    </Badge>
  );
}

/** Team number over its (FIRST API) name — the sticky first column of the team tables. */
export function TeamCell({ teamNumber, teamName, className }: { teamNumber: number; teamName: string | null; className?: string }) {
  const isOurs = useIsOurTeam()(teamNumber);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums">{teamNumber}</span>
        {isOurs && <OurTeamTag />}
      </div>
      <div className="truncate text-xs text-[var(--muted-foreground)]">{teamName ?? "—"}</div>
    </div>
  );
}

/**
 * A number with a thin bar filled with the theme accent, sized relative to
 * `max` (the best value in the table). The number carries the information —
 * the bar is a quick visual comparison — so it stays in the foreground ink.
 */
export function InlineBar({ value, max, digits = 1, emphasized }: { value: number; max: number; digits?: number; emphasized?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <span className={cn("tabular-nums", emphasized && "font-semibold")}>{value.toFixed(digits)}</span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--theme-gradient-h)" }}
        />
      </span>
    </div>
  );
}

/** "Low sample" flag for teams scouted fewer than the minimum number of times. */
export function LowSampleBadge({ entryCount, min, className }: { entryCount: number; min: number; className?: string }) {
  return (
    <Badge
      variant="warning"
      className={cn("gap-1 text-[10px]", className)}
      title={`Scouted ${entryCount} ${entryCount === 1 ? "time" : "times"} — fewer than ${min}, so treat this with caution`}
    >
      <AlertTriangle className="h-3 w-3" /> Low sample
    </Badge>
  );
}
