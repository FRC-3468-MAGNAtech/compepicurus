import { Activity, Gauge, ListChecks, Users } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { ScoutCategory, ScoutStatsSummary } from "@/lib/scout-stats/types";

export function SummaryStats({ category, summary }: { category: ScoutCategory; summary: ScoutStatsSummary }) {
  const sessionsLabel = category === "real-event" ? "Forms completed" : "Sessions completed";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Scout-to-member ratio"
        value={`${summary.membersWithData} / ${summary.totalMembers}`}
        icon={Users}
        index={0}
      />
      <StatCard
        label="Average accuracy"
        value={summary.averageAccuracy === null ? "?" : `${Math.round(summary.averageAccuracy)}%`}
        icon={Gauge}
        index={1}
      />
      <StatCard label={sessionsLabel} value={String(summary.sessionsOrFormsCompleted)} icon={Activity} index={2} />
      {category !== "real-event" && (
        <StatCard label="Total entries" value={String(summary.totalEntries ?? 0)} icon={ListChecks} index={3} />
      )}
    </div>
  );
}
