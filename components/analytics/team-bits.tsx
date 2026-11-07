import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Team number over its (FIRST API) name — the sticky first column of the team tables. */
export function TeamCell({ teamNumber, teamName, className }: { teamNumber: number; teamName: string | null; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="font-semibold tabular-nums">{teamNumber}</div>
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
