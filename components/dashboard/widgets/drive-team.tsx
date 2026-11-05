"use client";

import { useMemo } from "react";
import { Eye, History } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { AllianceChip, ResultBadge, TeamPreviewRow } from "@/components/dashboard/shared";
import { getPercentColor } from "@/lib/accuracy/engine";
import { buildMatchBreakdowns } from "@/lib/analytics/match-breakdown";
import { useDashboard, useOurTeamEvent } from "@/lib/dashboard/data";
import { cn } from "@/lib/utils";

/** The partner and both opponents for the next match: average, auto/teleop strengths, and reliability — straight from scouted `TeamStats`. */
export function MatchPreviewWidget({ opponentsOnly = false, title }: { opponentsOnly?: boolean; title?: string }) {
  const d = useDashboard();
  const next = d.nextMatch;
  const code = d.event?.code ?? null;
  const statsBy = useMemo(() => new Map(d.teamStats.map((s) => [s.teamNumber, s])), [d.teamStats]);

  const rows = next
    ? [
        ...(opponentsOnly || next.partner === null ? [] : [{ team: next.partner, role: "Partner" }]),
        ...next.opponents.map((t) => ({ team: t, role: "Opponent" })),
      ]
    : [];

  return (
    <Widget
      title={title ?? (opponentsOnly ? "Next-match opponents" : "Match preview")}
      icon={Eye}
      size="wide"
      status={d.first.loading || !d.entriesLoaded ? "loading" : rows.length === 0 ? "empty" : "ready"}
      href="/analytics/team-breakdown"
      linkLabel="Team Breakdown"
      emptyText={next ? "The alliances for our next match aren't published yet." : "No upcoming match to preview."}
      headerRight={next ? <AllianceChip color={next.alliance} className="py-0.5 text-[10px]" /> : undefined}
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {rows.map((r) => (
          <TeamPreviewRow key={r.team} teamNumber={r.team} teamName={d.teamNames.get(r.team) ?? null} stats={statsBy.get(r.team) ?? null} schema={d.schema} eventCode={code} role={r.role} />
        ))}
      </div>
    </Widget>
  );
}

/**
 * Our last played match: the official result, and — when scouts covered our
 * alliance — the scouted total beside it with its accuracy. (The same
 * alliance maths Match Breakdown uses, so the numbers agree with that page.)
 */
export function LastMatchRecapWidget() {
  const d = useDashboard();
  const t = useOurTeamEvent();
  const last = t.lastMatch;
  const code = d.event?.code ?? null;

  const alliance = useMemo(() => {
    if (!last) return null;
    const [row] = buildMatchBreakdowns({ matches: [last.match], entries: d.usedEntries, accuracyThreshold: null, practice: false });
    return row ? row[last.alliance] : null;
  }, [last, d.usedEntries]);

  return (
    <Widget
      title="Last match recap"
      icon={History}
      size="medium"
      status={t.first.loading || !d.entriesLoaded ? "loading" : !last ? "empty" : "ready"}
      href={last && code ? `/analytics/match-breakdown?event=${encodeURIComponent(code)}&match=${last.label}` : "/analytics/match-breakdown"}
      linkLabel="Full breakdown"
      emptyText="We haven't played a match at this event yet."
    >
      {last && (
        <>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-sm font-semibold">{last.label}</span>
            <AllianceChip color={last.alliance} />
            {last.result && <ResultBadge result={last.result} />}
          </div>
          <div className="text-4xl font-semibold tabular-nums tracking-tight">
            {last.ourScore} <span className="text-[var(--muted-foreground)]">–</span> {last.theirScore}
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-[var(--muted-foreground)]">
            {alliance?.official && (
              <span>
                Official {alliance.official.score}
                {alliance.official.penaltyPoints > 0 && <> (incl. {alliance.official.penaltyPoints} penalty)</>}
              </span>
            )}
            {alliance && alliance.scoutedCount > 0 ? (
              <span>
                Scouted {alliance.scoutedTotal}
                <span className="ml-1">
                  ({alliance.scoutedCount}/{alliance.teams.length} robots
                  {alliance.accuracy !== null && (
                    <>
                      {" · accuracy "}
                      <span className={cn("font-semibold", getPercentColor(alliance.accuracy))}>{Math.round(alliance.accuracy)}%</span>
                    </>
                  )}
                  )
                </span>
              </span>
            ) : (
              <span>Not scouted</span>
            )}
          </div>
        </>
      )}
    </Widget>
  );
}
