"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Award, Gem, ListOrdered, ShieldQuestion, Trophy } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, TeamLink } from "@/components/dashboard/shared";
import { getPercentColor } from "@/lib/accuracy/engine";
import { useDashboard, useOurTeamEvent } from "@/lib/dashboard/data";
import { averageAccuracy, findHiddenGems } from "@/lib/dashboard/insights";
import { formatRecord } from "@/lib/dashboard/schedule";
import { formatPickLikelihood, pickLikelihood, pickLikelihoodColor } from "@/lib/pickLikelihood";
import { cn } from "@/lib/utils";

/** Our official rank and record, and which way our scouted scoring is heading. */
export function RankTrendWidget() {
  const t = useOurTeamEvent();
  const d = useDashboard();
  const trend = d.ourStats?.trend;
  const Icon = trend?.direction === "up" ? ArrowUp : trend?.direction === "down" ? ArrowDown : ArrowRight;

  return (
    <Widget title="Our rank & trend" icon={Trophy} size="small" status={t.first.loading ? "loading" : "ready"} href="/analytics/rankings" linkLabel="Rankings">
      <KeyNumber label="Official rank" value={t.ourRanking ? `#${t.ourRanking.rank}` : "-"} hint={`${formatRecord(t.record)} · ${t.fieldSize > 0 ? `of ${t.fieldSize} teams` : "rankings not published"}`} />
      {trend && trend.direction !== null ? (
        <div className={cn("flex items-center gap-1 text-xs font-medium", trend.direction === "up" ? "text-emerald-300" : trend.direction === "down" ? "text-red-300" : "text-[var(--muted-foreground)]")}>
          <Icon className="h-3.5 w-3.5" />
          {trend.direction === "flat" ? "Scoring steady" : `Scoring ${trend.direction} ${trend.delta > 0 ? "+" : ""}${trend.delta.toFixed(1)}`}
        </div>
      ) : (
        <div className="text-xs text-[var(--muted-foreground)]">Scoring trend needs 4+ scouted matches</div>
      )}
    </Widget>
  );
}

/** The first five teams on the shared pick list, with each one's Pick %. */
export function PickSnapshotWidget() {
  const d = useDashboard();
  const picked = d.pickList?.picked.slice(0, 5) ?? [];
  const code = d.event?.code ?? null;
  const rankBy = useMemo(() => new Map(d.rankings.map((r) => [r.teamNumber, r.rank])), [d.rankings]);
  const ourRank = d.ourRanking?.rank ?? null;

  return (
    <Widget
      title="Pick list"
      icon={ListOrdered}
      size="medium"
      status={!d.pickListLoaded || d.first.loading ? "loading" : picked.length === 0 ? "empty" : "ready"}
      href="/analytics/pick-list"
      linkLabel="Open the Pick List"
      emptyText="Nobody is on the pick list yet."
    >
      <div className="flex flex-col gap-1.5">
        {picked.map((team, i) => {
          const p = pickLikelihood(rankBy.get(team) ?? null, ourRank, d.fieldSize);
          return (
            <div key={team} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
              <span className="w-5 text-center text-xs font-semibold tabular-nums text-[var(--muted-foreground)]">{i + 1}</span>
              <TeamLink teamNumber={team} eventCode={code} />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">{d.teamNames.get(team) ?? ""}</span>
              <span className="text-xs tabular-nums text-[var(--muted-foreground)]" title="Official rank">
                {rankBy.has(team) ? `#${rankBy.get(team)}` : "-"}
              </span>
              <span className="w-10 text-right text-xs font-semibold tabular-nums" style={{ color: pickLikelihoodColor(p) }} title="Estimate, not a prediction">
                {formatPickLikelihood(p)}
              </span>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}

/** The five best teams by scouted average (teams with too few entries aren't ranked). */
export function TopTeamsWidget() {
  const d = useDashboard();
  const top = useMemo(() => d.ranked.filter((r) => r.rank !== null).slice(0, 5), [d.ranked]);
  const code = d.event?.code ?? null;

  return (
    <Widget
      title="Top teams (scouted)"
      icon={Award}
      size="medium"
      status={!d.entriesLoaded ? "loading" : top.length === 0 ? "empty" : "ready"}
      href="/analytics/rankings"
      linkLabel="Rankings"
      emptyText="No team has enough scouted matches to rank yet."
    >
      <div className="flex flex-col gap-1.5">
        {top.map((r) => (
          <div key={r.stats.teamNumber} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
            <span className="w-5 text-center text-xs font-semibold tabular-nums">{r.rank}</span>
            <TeamLink teamNumber={r.stats.teamNumber} eventCode={code} />
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">{r.stats.teamName ?? ""}</span>
            <span className="font-semibold tabular-nums">{r.stats.avgTotal.toFixed(1)}</span>
            <span className="w-8 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">{r.stats.entryCount}×</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/** How much to trust the numbers: the mean alliance accuracy and how many entries they're built from. */
export function DataConfidenceWidget() {
  const d = useDashboard();
  const accuracy = useMemo(() => averageAccuracy(d.usedEntries), [d.usedEntries]);

  return (
    <Widget title="Data confidence" icon={ShieldQuestion} size="small" status={!d.entriesLoaded ? "loading" : d.usedEntries.length === 0 ? "empty" : "ready"} href="/scout-accuracy" linkLabel="Scout Accuracy" emptyText="No scouted entries at this event yet.">
      <KeyNumber
        label="Avg accuracy"
        value={<span className={cn(accuracy !== null && getPercentColor(accuracy))}>{accuracy === null ? "—" : `${Math.round(accuracy)}%`}</span>}
        hint={`${d.usedEntries.length} entries · ${d.teamStats.length} teams`}
      />
    </Widget>
  );
}

/** Teams whose scouted rank is far better than their official rank — strong robots the standings haven't caught up to. */
export function HiddenGemsWidget() {
  const d = useDashboard();
  const code = d.event?.code ?? null;
  const gems = useMemo(() => {
    const rankBy = new Map(d.rankings.map((r) => [r.teamNumber, r.rank]));
    return findHiddenGems({
      teams: d.ranked.map((r) => ({ teamNumber: r.stats.teamNumber, teamName: r.stats.teamName, officialRank: rankBy.get(r.stats.teamNumber) ?? null, scoutedRank: r.rank, entryCount: r.stats.entryCount })),
      fieldSize: d.fieldSize,
    });
  }, [d.ranked, d.rankings, d.fieldSize]);

  return (
    <Widget
      title="Hidden gems"
      icon={Gem}
      size="medium"
      status={d.first.loading || !d.entriesLoaded ? "loading" : gems.length === 0 ? "empty" : "ready"}
      href="/analytics/rankings"
      linkLabel="Rankings"
      emptyText={d.rankings.length === 0 ? "Needs the official rankings — none are published yet." : "No team is scouted far better than it's ranked."}
    >
      <div className="text-xs text-[var(--muted-foreground)]">Scouted rank much better than official rank</div>
      <div className="flex flex-col gap-1.5">
        {gems.map((g) => (
          <div key={g.teamNumber} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
            <TeamLink teamNumber={g.teamNumber} eventCode={code} />
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">{g.teamName ?? ""}</span>
            <span className="text-xs tabular-nums">
              Scouted <strong>#{g.scoutedRank}</strong> · Official <strong>#{g.officialRank}</strong>
            </span>
            <span className="w-9 text-right text-xs font-semibold tabular-nums text-emerald-300">+{g.gap}</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}
