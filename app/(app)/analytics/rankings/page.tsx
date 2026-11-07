"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TeamTable, type TeamTableColumn, type TeamTableSort } from "@/components/analytics/team-table";
import { LowSampleBadge, OUR_TEAM_ROW_CLASS, TeamCell } from "@/components/analytics/team-bits";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { useTeamStats } from "@/lib/analytics/data-context";
import { DEFAULT_MIN_ENTRIES, RANK_METRICS, metricValue, rankTeams, type RankMetric, type RankedTeam } from "@/lib/analytics/team-stats";
import { cn } from "@/lib/utils";

const MIN_ENTRY_CHOICES = [1, 2, 3, 4, 5];

function formatMetric(metric: RankMetric, value: number): string {
  return metric === "consistency" ? `${Math.round(value)}%` : metric === "highTotal" ? String(value) : value.toFixed(1);
}

export default function RankingsPage() {
  const { teamStats, loaded } = useTeamStats();
  const isOurs = useIsOurTeam();
  const [metric, setMetric] = useState<RankMetric>("avgTotal");
  const [minEntries, setMinEntries] = useState(DEFAULT_MIN_ENTRIES);
  // Sorting never touches the rank numbers: they come from rankTeams(), the sort only reorders rows.
  const [sort, setSort] = useState<TeamTableSort>({ key: "rank", direction: "asc" });

  const ranked = useMemo(() => rankTeams(teamStats, metric, minEntries), [teamStats, metric, minEntries]);
  const metricLabel = RANK_METRICS.find((m) => m.id === metric)!.label;
  const lowSampleCount = ranked.filter((r) => r.lowSample).length;

  const columns = useMemo<TeamTableColumn<RankedTeam>[]>(() => {
    const plain = (id: RankMetric, label: string, width: number): TeamTableColumn<RankedTeam> => ({
      key: id,
      label,
      width,
      align: "right",
      sortValue: (r) => metricValue(r.stats, id),
      render: (r) => <span className="tabular-nums">{formatMetric(id, metricValue(r.stats, id))}</span>,
    });
    return [
      {
        key: "rank",
        label: "Rank",
        width: 90,
        sticky: true,
        sortValue: (r) => r.rank,
        render: (r) => <RankBadge rank={r.rank} />,
      },
      {
        key: "team",
        label: "Team",
        width: 200,
        sticky: true,
        sortValue: (r) => r.stats.teamNumber,
        render: (r) => <TeamCell teamNumber={r.stats.teamNumber} teamName={r.stats.teamName} />,
      },
      {
        key: "ranked",
        label: metricLabel,
        width: 150,
        align: "right",
        sortValue: (r) => r.value,
        render: (r) => <span className="text-base font-semibold tabular-nums">{formatMetric(metric, r.value)}</span>,
      },
      {
        key: "entryCount",
        label: "Times scouted",
        width: 190,
        align: "right",
        sortValue: (r) => r.stats.entryCount,
        render: (r) => (
          <span className="flex items-center justify-end gap-2">
            {r.lowSample && <LowSampleBadge entryCount={r.stats.entryCount} min={minEntries} />}
            <span className="tabular-nums">{r.stats.entryCount}</span>
          </span>
        ),
      },
      // Every other metric, so the table stays useful while ranking by one of them.
      ...RANK_METRICS.filter((m) => m.id !== metric).map((m) => plain(m.id, m.label, m.id === "avgEndgame" ? 130 : 115)),
    ];
  }, [metric, metricLabel, minEntries]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Rankings</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Teams ranked from scouted data (not the official event rankings). Ties share a rank (1, 2, 2, 4).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="rank-by">Rank by</Label>
            <Select value={metric} onValueChange={(v) => setMetric(v as RankMetric)}>
              <SelectTrigger id="rank-by" className="w-44">
                <SelectValue>{metricLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANK_METRICS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="min-entries">Min. entries</Label>
            <Select value={String(minEntries)} onValueChange={(v) => setMinEntries(Number(v))}>
              <SelectTrigger id="min-entries" className="w-28">
                <SelectValue>{minEntries}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MIN_ENTRY_CHOICES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {!loaded ? (
        <div className="glass-card h-72 animate-pulse" />
      ) : ranked.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No scouted data with the current filters. Try widening the Event, Accuracy, or Practice settings above.
        </GlassPanel>
      ) : (
        <>
          {lowSampleCount > 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">
              {lowSampleCount} {lowSampleCount === 1 ? "team has" : "teams have"} fewer than {minEntries} entries — shown below the ranked teams and left unranked, so
              a single lucky match can&apos;t top the list.
            </p>
          )}
          <TeamTable
            rows={ranked}
            columns={columns}
            getKey={(r) => r.stats.teamNumber}
            getHref={(r) => `/analytics/teams/${r.stats.teamNumber}`}
            sort={sort}
            onSortChange={setSort}
            rowClassName={(r) =>
              isOurs(r.stats.teamNumber) ? OUR_TEAM_ROW_CLASS : r.rank !== null && r.rank <= 3 ? "bg-[rgba(var(--glow),0.09)]" : r.lowSample ? "opacity-70" : undefined
            }
          />
        </>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="px-2 text-[var(--muted-foreground)]" title="Not ranked — too few entries">—</span>;
  const top = rank <= 3;
  return (
    <span
      className={cn(
        "flex h-9 min-w-9 items-center justify-center rounded-full px-2 font-semibold tabular-nums",
        top ? "glass-pill shadow-[0_0_18px_rgba(var(--glow),0.4)]" : "text-[var(--muted-foreground)]"
      )}
      style={top ? { color: "var(--color-primary)" } : undefined}
    >
      {rank}
    </span>
  );
}
