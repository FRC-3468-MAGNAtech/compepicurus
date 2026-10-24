import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { getPercentColor } from "@/lib/accuracy/engine";
import { cardEntranceVariants } from "@/lib/motion";
import type { ScoutCategory, ScoutCategoryDetail } from "@/lib/scout-stats/types";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<ScoutCategory, string> = {
  trial: "Trial",
  competitive: "Competitive",
  "real-event": "Real Event",
};

export function MyScoutingCard({
  category,
  detail,
  rank,
  index,
}: {
  category: ScoutCategory;
  detail: ScoutCategoryDetail;
  rank: number | null;
  index: number;
}) {
  return (
    <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" custom={index}>
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {CATEGORY_LABELS[category]}
          </span>
          <span className="font-mono text-xs text-[var(--muted-foreground)]">{rank ? `#${rank}` : "?"}</span>
        </div>
        <div className={cn("text-3xl font-semibold tracking-tight", detail.averageAccuracy !== null ? getPercentColor(detail.averageAccuracy) : "")}>
          {detail.averageAccuracy === null ? "?" : `${Math.round(detail.averageAccuracy)}%`}
        </div>
        {detail.status && <Badge className={cn("self-start", detail.status.badgeClassName)}>{detail.status.label}</Badge>}
        <div className="flex gap-4 text-xs text-[var(--muted-foreground)]">
          <span>{detail.sessionsOrForms} {category === "real-event" ? "forms" : "sessions"}</span>
          {category !== "real-event" && <span>{detail.totalEntries ?? 0} entries</span>}
        </div>
      </GlassPanel>
    </motion.div>
  );
}
