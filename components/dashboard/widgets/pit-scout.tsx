"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquareText, Search, UserSearch, UsersRound } from "lucide-react";
import { CommentCell } from "@/components/analytics/comment-cell";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, TeamLink, teamHref } from "@/components/dashboard/shared";
import { Input } from "@/components/ui/input";
import { formatMatch } from "@/lib/analytics/game-schema";
import { useDashboard } from "@/lib/dashboard/data";
import { computeTeamCoverage } from "@/lib/dashboard/insights";

/** The event's team numbers: the FIRST team list, plus anyone we've scouted (so coverage still means something if the team list failed to load). */
function useEventTeamNumbers(): number[] {
  const d = useDashboard();
  return useMemo(() => [...new Set([...d.teams.map((t) => t.teamNumber), ...d.eventEntries.map((e) => e.teamNumber)])], [d.teams, d.eventEntries]);
}

/** How many of the event's teams have at least one scout entry. */
export function TeamCoverageWidget() {
  const d = useDashboard();
  const teams = useEventTeamNumbers();
  const coverage = useMemo(() => computeTeamCoverage(teams, d.eventEntries), [teams, d.eventEntries]);

  return (
    <Widget
      title="Teams scouted"
      icon={UsersRound}
      size="small"
      status={!d.entriesLoaded || d.first.loading ? "loading" : coverage.total === 0 ? "empty" : "ready"}
      href="/analytics/team-averages"
      linkLabel="Team Averages"
      emptyText="No teams to cover yet — the event's team list isn't available."
    >
      <KeyNumber label="Coverage" value={`${coverage.percent ?? 0}%`} hint={`${coverage.scouted} of ${coverage.total} teams have an entry`} />
    </Widget>
  );
}

const SHOWN = 10;

/** Teams at the event with no match entries at all — where a pit scout's time is best spent. */
export function ZeroEntryTeamsWidget() {
  const d = useDashboard();
  const teams = useEventTeamNumbers();
  const coverage = useMemo(() => computeTeamCoverage(teams, d.eventEntries), [teams, d.eventEntries]);
  const code = d.event?.code ?? null;
  const more = coverage.zero.length - SHOWN;

  return (
    <Widget
      title="Teams with no entries"
      icon={UserSearch}
      size="medium"
      status={!d.entriesLoaded || d.first.loading ? "loading" : coverage.total === 0 ? "empty" : "ready"}
      href="/analytics/team-averages"
      linkLabel="Team Averages"
      emptyText="No teams to list yet."
    >
      {coverage.zero.length === 0 ? (
        <p className="text-sm text-emerald-300">Every team at this event has at least one entry.</p>
      ) : (
        <>
          <div className="text-xs text-[var(--muted-foreground)]">{coverage.zero.length} {coverage.zero.length === 1 ? "team has" : "teams have"} no match entries yet</div>
          <div className="flex flex-wrap gap-1.5">
            {coverage.zero.slice(0, SHOWN).map((t) => (
              <Link key={t} href={teamHref(t, code)} className="glass-pill px-3 py-1.5 text-sm font-semibold tabular-nums transition-shadow hover:shadow-[0_0_20px_2px_rgba(var(--glow),0.3)]" title={d.teamNames.get(t)}>
                {t}
              </Link>
            ))}
            {more > 0 && <span className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">+{more} more</span>}
          </div>
        </>
      )}
    </Widget>
  );
}

/** Type a team number or name; jump straight to its Team Profile. */
export function TeamLookupWidget() {
  const d = useDashboard();
  const [query, setQuery] = useState("");
  const code = d.event?.code ?? null;

  const candidates = useMemo(() => {
    const byNumber = new Map<number, string | null>();
    for (const t of d.teams) byNumber.set(t.teamNumber, t.nameShort);
    for (const e of d.eventEntries) if (!byNumber.has(e.teamNumber)) byNumber.set(e.teamNumber, d.teamNames.get(e.teamNumber) ?? null);
    return [...byNumber.entries()].map(([teamNumber, name]) => ({ teamNumber, name })).sort((a, b) => a.teamNumber - b.teamNumber);
  }, [d.teams, d.eventEntries, d.teamNames]);

  const q = query.trim().toLowerCase();
  const results = q === "" ? [] : candidates.filter((c) => String(c.teamNumber).includes(q) || (c.name ?? "").toLowerCase().includes(q)).slice(0, 6);

  return (
    <Widget title="Team lookup" icon={Search} size="medium" status={d.first.loading && candidates.length === 0 ? "loading" : "ready"}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Team number or name..." className="pl-10" aria-label="Look up a team" />
      </div>
      {q === "" ? (
        <p className="text-xs text-[var(--muted-foreground)]">Opens the team&apos;s profile for this event.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No team matches &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {results.map((r) => (
            <Link key={r.teamNumber} href={teamHref(r.teamNumber, code)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-white/10">
              <span className="font-semibold tabular-nums">{r.teamNumber}</span>
              <span className="truncate text-xs text-[var(--muted-foreground)]">{r.name ?? "—"}</span>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}

/** The latest scout comments at the event, collapsed to one line each — tap to expand. */
export function LatestCommentsWidget() {
  const d = useDashboard();
  const code = d.event?.code ?? null;
  const comments = useMemo(
    () =>
      d.usedEntries
        .filter((e) => e.comments.trim() !== "")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .slice(0, 6),
    [d.usedEntries]
  );

  return (
    <Widget
      title="Latest scout comments"
      icon={MessageSquareText}
      size="wide"
      status={!d.entriesLoaded ? "loading" : comments.length === 0 ? "empty" : "ready"}
      href="/analytics/match-scout"
      linkLabel="Match Scout Analytics"
      emptyText="No scout comments at this event yet."
    >
      <div className="flex flex-col gap-1.5">
        {comments.map((e) => (
          <div key={e.id} className="flex items-start gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-2 text-sm">
            <span className="min-w-10 pt-0.5 font-mono text-xs font-semibold">{formatMatch(e)}</span>
            <TeamLink teamNumber={e.teamNumber} eventCode={code} className="min-w-10 pt-0.5 text-xs" />
            <div className="min-w-0 flex-1">
              <CommentCell text={e.comments} forceExpanded={false} />
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}
