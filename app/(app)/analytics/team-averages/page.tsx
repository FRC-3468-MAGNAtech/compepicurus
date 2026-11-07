"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { TeamTable, type TeamTableColumn, type TeamTableSort } from "@/components/analytics/team-table";
import { InlineBar, OUR_TEAM_ROW_CLASS, TeamCell } from "@/components/analytics/team-bits";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { useTeamStats } from "@/lib/analytics/data-context";
import type { TeamStats } from "@/lib/analytics/team-stats";

export default function TeamAveragesPage() {
  const { teamStats, loaded } = useTeamStats();
  const isOurs = useIsOurTeam();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TeamTableSort>({ key: "avgTotal", direction: "desc" });

  const best = useMemo(() => Math.max(0, ...teamStats.map((t) => t.avgTotal)), [teamStats]);

  const columns = useMemo<TeamTableColumn<TeamStats>[]>(
    () => [
      {
        key: "team",
        label: "Team",
        width: 200,
        sticky: true,
        sortValue: (t) => t.teamNumber,
        render: (t) => <TeamCell teamNumber={t.teamNumber} teamName={t.teamName} />,
      },
      { key: "entryCount", label: "Times scouted", width: 130, align: "right", sortValue: (t) => t.entryCount, render: (t) => <span className="tabular-nums">{t.entryCount}</span> },
      {
        key: "avgTotal",
        label: "Avg. total",
        width: 190,
        align: "right",
        sortValue: (t) => t.avgTotal,
        render: (t) => <InlineBar value={t.avgTotal} max={best} emphasized />,
      },
      { key: "avgAuto", label: "Avg. auto", width: 110, align: "right", sortValue: (t) => t.avgAuto, render: (t) => <span className="tabular-nums">{t.avgAuto.toFixed(1)}</span> },
      { key: "avgTeleop", label: "Avg. teleop", width: 120, align: "right", sortValue: (t) => t.avgTeleop, render: (t) => <span className="tabular-nums">{t.avgTeleop.toFixed(1)}</span> },
      { key: "avgEndgame", label: "Avg. endgame", width: 130, align: "right", sortValue: (t) => t.avgEndgame, render: (t) => <span className="tabular-nums">{t.avgEndgame.toFixed(1)}</span> },
      { key: "highTotal", label: "High", width: 90, align: "right", sortValue: (t) => t.highTotal, render: (t) => <span className="tabular-nums">{t.highTotal}</span> },
      {
        key: "consistency",
        label: "Consistency",
        width: 130,
        align: "right",
        sortValue: (t) => t.consistency,
        render: (t) => <span className="tabular-nums">{Math.round(t.consistency)}%</span>,
      },
    ],
    [best]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teamStats;
    return teamStats.filter((t) => String(t.teamNumber).includes(q) || (t.teamName ?? "").toLowerCase().includes(q));
  }, [teamStats, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Team Averages</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Every scouted team, averaged across the entries the filters above let through. Tap a team for its full profile.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team number or name..." className="pl-10" aria-label="Search teams" />
        </div>
      </div>

      {!loaded ? (
        <div className="glass-card h-72 animate-pulse" />
      ) : teamStats.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No scouted data with the current filters. Try widening the Event, Accuracy, or Practice settings above.
        </GlassPanel>
      ) : (
        <>
          <p className="text-xs text-[var(--muted-foreground)]">
            {rows.length === teamStats.length ? `${teamStats.length} teams` : `${rows.length} of ${teamStats.length} teams`}
          </p>
          <TeamTable
            rows={rows}
            columns={columns}
            getKey={(t) => t.teamNumber}
            getHref={(t) => `/analytics/teams/${t.teamNumber}`}
            sort={sort}
            onSortChange={setSort}
            rowClassName={(t) => (isOurs(t.teamNumber) ? OUR_TEAM_ROW_CLASS : undefined)}
            empty={<>No teams match &ldquo;{search}&rdquo;.</>}
          />
        </>
      )}
    </div>
  );
}
