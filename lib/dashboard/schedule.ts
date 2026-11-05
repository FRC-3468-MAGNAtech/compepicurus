import type { AllianceColor, OfficialMatch } from "@/lib/analytics/match-breakdown";
import { formatMatch, matchSortValue } from "@/lib/analytics/game-schema";
import { parseEventTime } from "@/lib/dashboard/time";
import type { FtcRanking } from "@/lib/ftc/types";

// Our team's slice of an event's official schedule (P13): next match, results,
// record, and the shareable result line. Pure; the dashboard's shared
// `useOurTeamEvent()` is the only caller that fetches.

export type MatchResult = "W" | "L" | "T";

export type OurMatch = {
  match: OfficialMatch;
  /** "Q12" — P / Q / F prefixed. */
  label: string;
  alliance: AllianceColor;
  /** Our alliance partner (null if the roster isn't published). */
  partner: number | null;
  opponents: number[];
  /** Scheduled start as an instant, or null when the API gave none. Always a *schedule*, never a promise. */
  startMs: number | null;
  played: boolean;
  /** Official scores (penalty points included, as FIRST reports them); null until played. */
  ourScore: number | null;
  theirScore: number | null;
  result: MatchResult | null;
};

function sideOf(match: OfficialMatch, team: number): AllianceColor | null {
  if (match.red.teams.includes(team)) return "red";
  if (match.blue.teams.includes(team)) return "blue";
  return null;
}

/** Every official match we're in, in play order (Practice, Qualification, then Playoff; by number). */
export function buildOurMatches(matches: OfficialMatch[], ourTeam: number | null, timeZone: string | null): OurMatch[] {
  if (ourTeam === null) return [];
  const ours: OurMatch[] = [];
  for (const match of matches) {
    const alliance = sideOf(match, ourTeam);
    if (!alliance) continue;
    const mine = alliance === "red" ? match.red : match.blue;
    const theirs = alliance === "red" ? match.blue : match.red;
    const scored = match.played && mine.score !== null && theirs.score !== null;
    ours.push({
      match,
      label: formatMatch(match),
      alliance,
      partner: mine.teams.find((t) => t !== ourTeam) ?? null,
      opponents: theirs.teams,
      startMs: parseEventTime(match.startTime, timeZone),
      played: match.played,
      ourScore: scored ? mine.score : null,
      theirScore: scored ? theirs.score : null,
      result: scored ? (mine.score! > theirs.score! ? "W" : mine.score! < theirs.score! ? "L" : "T") : null,
    });
  }
  return ours.sort((a, b) => matchSortValue(a.match) - matchSortValue(b.match));
}

/** The first match we haven't played yet, in play order. */
export function nextOurMatch(ours: OurMatch[]): OurMatch | null {
  return ours.find((m) => !m.played) ?? null;
}

/** The matches after `next` (or all unplayed, if `next` is null), for an "upcoming" list. */
export function upcomingOurMatches(ours: OurMatch[], limit: number): OurMatch[] {
  return ours.filter((m) => !m.played).slice(0, limit);
}

/** Played matches, most recent first. */
export function recentOurResults(ours: OurMatch[], limit: number): OurMatch[] {
  return ours
    .filter((m) => m.played && m.result !== null)
    .slice(-limit)
    .reverse();
}

export type Record3 = { wins: number; losses: number; ties: number };

/** Official qualification record when rankings exist; otherwise counted from our played Qualification matches. */
export function ourRecord(ranking: FtcRanking | null, ours: OurMatch[]): Record3 | null {
  if (ranking) return { wins: ranking.wins, losses: ranking.losses, ties: ranking.ties };
  const played = ours.filter((m) => m.match.matchType === "Qualification" && m.result !== null);
  if (played.length === 0) return null;
  return {
    wins: played.filter((m) => m.result === "W").length,
    losses: played.filter((m) => m.result === "L").length,
    ties: played.filter((m) => m.result === "T").length,
  };
}

export const formatRecord = (r: Record3 | null): string => (r ? `${r.wins}-${r.losses}-${r.ties}` : "-");

/** `Q12: Red 85 - Blue 70 (W)` — the (W/L/T) is from our point of view and omitted when we weren't in the match. */
export function matchShareText(match: OfficialMatch, ourTeam: number | null): string | null {
  if (!match.played || match.red.score === null || match.blue.score === null) return null;
  const side = ourTeam === null ? null : sideOf(match, ourTeam);
  const mine = side === "red" ? match.red.score : match.blue.score;
  const theirs = side === "red" ? match.blue.score : match.red.score;
  const result = side === null ? "" : ` (${mine > theirs ? "W" : mine < theirs ? "L" : "T"})`;
  return `${formatMatch(match)}: Red ${match.red.score} - Blue ${match.blue.score}${result}`;
}
