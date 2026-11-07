import { computeAllianceAccuracy } from "@/lib/analytics/accuracy";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import { formatMatch, matchSortValue } from "@/lib/analytics/game-schema";
import { schemaFieldMeta } from "@/lib/analytics/team-stats";
import type { FtcMatch, MatchType } from "@/lib/ftc/types";
import type { LibraryMatch } from "@/lib/match-library";
import type { Form } from "@/lib/forms/types";
import { elementOf } from "@/lib/forms/meta";
import { entryValues } from "@/lib/forms/legacy";

// Pure model behind Match Breakdown (P11): official matches joined to the
// scouted entries for them, per alliance. The UI only renders what this
// returns — in particular an alliance the accuracy filter rejects comes back
// with its scouted numbers already withheld, so no rendering path can leak
// them.

export type AllianceColor = "red" | "blue";

export type OfficialAlliance = {
  teams: number[];
  /** The official alliance score (penalty points already folded in), or null when not available. */
  score: number | null;
  penaltyPoints: number | null;
};

/** One official match, whichever source it came from (FIRST API event match or imported library match). */
export type OfficialMatch = {
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  /** Whether the match has been played / scored. */
  played: boolean;
  /** The FIRST API's playoff series number, when it gave one (P16 uses it to find the Finals series). */
  series?: number | null;
  /** Scheduled (or actual) start as the FIRST API gives it — usually event-local wall time with no offset. P13's dashboard turns it into an instant with the event's timezone. */
  startTime?: string | null;
  red: OfficialAlliance;
  blue: OfficialAlliance;
};

export function ftcMatchToOfficial(eventCode: string, m: FtcMatch): OfficialMatch {
  return {
    eventCode,
    matchType: m.type,
    matchNumber: m.matchNumber,
    played: m.played,
    series: m.series,
    startTime: m.startTime,
    red: { teams: m.redTeams, score: m.redScore, penaltyPoints: m.redPenaltyPoints },
    blue: { teams: m.blueTeams, score: m.blueScore, penaltyPoints: m.bluePenaltyPoints },
  };
}

/** Library matches are always scored (they're imported from finished events). */
export function libraryMatchToOfficial(m: LibraryMatch): OfficialMatch {
  return {
    eventCode: m.eventCode,
    matchType: m.matchType,
    matchNumber: m.matchNumber,
    played: true,
    red: { teams: m.alliances.red.teams, score: m.alliances.red.score, penaltyPoints: m.alliances.red.penaltyPoints },
    blue: { teams: m.alliances.blue.teams, score: m.alliances.blue.score, penaltyPoints: m.alliances.blue.penaltyPoints },
  };
}

export type AllianceVisibility =
  /** Scouted numbers are available and shown. */
  | "shown"
  /** No robot of this alliance was scouted. */
  | "not-scouted"
  /** Scouted, but the accuracy filter rejected it — numbers withheld. */
  | "below-accuracy";

export type TeamSlot = {
  teamNumber: number;
  /** Whether this robot has a (non-excluded) scout entry — counted for coverage even when the numbers are withheld. */
  scouted: boolean;
  /** The entry to show; null when not scouted or when the alliance's numbers are withheld. */
  entry: AnalyticsEntry | null;
};

export type AllianceBreakdown = {
  color: AllianceColor;
  teams: TeamSlot[];
  scoutedCount: number;
  visibility: AllianceVisibility;
  /** Sum of the scouted robot scores; null unless `visibility === "shown"`. */
  scoutedTotal: number | null;
  /** Alliance accuracy (0-100) from the shared engine; null when it can't be computed. Kept even when numbers are withheld — the reason label quotes it. */
  accuracy: number | null;
  /** The official score, with its penalty points when any were awarded; null when the official score isn't available. */
  official: { score: number; penaltyPoints: number } | null;
  /** "Below accuracy filter (62%)" etc. — set exactly when `visibility === "below-accuracy"`. */
  hiddenReason: string | null;
};

export type MatchBreakdown = {
  /** `${eventCode}|${matchType}|${matchNumber}` — unique across events. */
  key: string;
  match: OfficialMatch;
  /** "Q12" — P / Q / F prefixed, like Match Scout Analytics. */
  label: string;
  red: AllianceBreakdown;
  blue: AllianceBreakdown;
  robotsScouted: number;
  robotsTotal: number;
  /** At least one robot scouted. */
  scouted: boolean;
  winner: AllianceColor | "tie" | null;
  winnerBasis: "official" | "scouted" | null;
  /** Red's share (0-1) of the two scouted totals; null unless both alliances are shown. */
  redFraction: number | null;
};

export function matchKey(eventCode: string, matchType: MatchType, matchNumber: number): string {
  return `${eventCode}|${matchType}|${matchNumber}`;
}

function latestPerTeam(entries: AnalyticsEntry[], teams: number[]): Map<number, AnalyticsEntry> {
  const latest = new Map<number, AnalyticsEntry>();
  for (const e of entries) {
    if (!teams.includes(e.teamNumber)) continue;
    const cur = latest.get(e.teamNumber);
    if (!cur || e.submittedAt > cur.submittedAt) latest.set(e.teamNumber, e);
  }
  return latest;
}

/**
 * Practice/live data can hold many sessions of the same alliance (different
 * scouts, repeated attempts). One alliance is one session's scouting, so use
 * the most recent session's entries rather than mixing robots across sessions.
 */
function latestSessionEntries(entries: AnalyticsEntry[]): AnalyticsEntry[] {
  const bySession = new Map<string, AnalyticsEntry[]>();
  for (const e of entries) {
    const key = e.sessionId ?? `entry:${e.id}`;
    const list = bySession.get(key);
    if (list) list.push(e);
    else bySession.set(key, [e]);
  }
  let best: AnalyticsEntry[] = [];
  let bestAt = "";
  for (const list of bySession.values()) {
    const at = list.reduce((m, e) => (e.submittedAt > m ? e.submittedAt : m), "");
    if (at > bestAt) {
      bestAt = at;
      best = list;
    }
  }
  return best;
}

function buildAlliance(
  color: AllianceColor,
  official: OfficialAlliance,
  matchEntries: AnalyticsEntry[],
  threshold: number | null,
  practice: boolean
): AllianceBreakdown {
  const own = matchEntries.filter((e) => official.teams.includes(e.teamNumber));
  const allianceEntries = practice ? latestSessionEntries(own) : own;
  const latest = latestPerTeam(allianceEntries, official.teams);

  const slots = official.teams.map((teamNumber) => ({ teamNumber, entry: latest.get(teamNumber) ?? null }));
  const scoutedCount = slots.filter((s) => s.entry).length;

  // The shared engine (via the Match Analytics wrapper) — never a second formula.
  const result = computeAllianceAccuracy(official.teams, official.score, official.penaltyPoints, allianceEntries);
  const accuracy = result.status === "complete" && result.value !== null ? result.value * 100 : null;

  const officialScore = official.score === null ? null : { score: official.score, penaltyPoints: official.penaltyPoints ?? 0 };

  let visibility: AllianceVisibility = "shown";
  let hiddenReason: string | null = null;
  if (scoutedCount === 0) visibility = "not-scouted";
  else if (threshold !== null && !(accuracy !== null && Math.round(accuracy) >= threshold)) {
    visibility = "below-accuracy";
    hiddenReason =
      accuracy !== null
        ? `Below accuracy filter (${Math.round(accuracy)}%)`
        : `Accuracy can't be computed — filtered out at ${threshold}%+`;
  }

  const shown = visibility === "shown";
  return {
    color,
    teams: slots.map((s) => ({ teamNumber: s.teamNumber, scouted: s.entry !== null, entry: shown ? s.entry : null })),
    scoutedCount,
    visibility,
    scoutedTotal: shown ? slots.reduce((sum, s) => sum + (s.entry?.score.total ?? 0), 0) : null,
    accuracy,
    official: officialScore,
    hiddenReason,
  };
}

function decideWinner(match: OfficialMatch, red: AllianceBreakdown, blue: AllianceBreakdown): Pick<MatchBreakdown, "winner" | "winnerBasis"> {
  const compare = (a: number, b: number): AllianceColor | "tie" => (a > b ? "red" : a < b ? "blue" : "tie");

  if (match.played && match.red.score !== null && match.blue.score !== null) {
    return { winner: compare(match.red.score, match.blue.score), winnerBasis: "official" };
  }
  // No official result: fall back to the scouted totals, but only when both alliances are fully
  // scouted and visible — a half-scouted alliance would just look like it lost.
  const complete = (a: AllianceBreakdown) => a.visibility === "shown" && a.teams.length > 0 && a.scoutedCount === a.teams.length;
  if (complete(red) && complete(blue)) return { winner: compare(red.scoutedTotal ?? 0, blue.scoutedTotal ?? 0), winnerBasis: "scouted" };
  return { winner: null, winnerBasis: null };
}

/**
 * One breakdown per official match. `entries` must already be the entries a
 * page may use *before* the accuracy filter (Game / Event / Practice scoped,
 * excluded dropped) — the filter is applied here, per alliance, so a rejected
 * alliance can be shown dimmed instead of vanishing.
 */
export function buildMatchBreakdowns(input: {
  matches: OfficialMatch[];
  entries: AnalyticsEntry[];
  /** Whole percent, or null for ALL. */
  accuracyThreshold: number | null;
  practice: boolean;
}): MatchBreakdown[] {
  const byMatch = new Map<string, AnalyticsEntry[]>();
  for (const e of input.entries) {
    const key = matchKey(e.eventCode, e.matchType, e.matchNumber);
    const list = byMatch.get(key);
    if (list) list.push(e);
    else byMatch.set(key, [e]);
  }

  const rows = input.matches.map((match): MatchBreakdown => {
    const key = matchKey(match.eventCode, match.matchType, match.matchNumber);
    const matchEntries = byMatch.get(key) ?? [];
    const red = buildAlliance("red", match.red, matchEntries, input.accuracyThreshold, input.practice);
    const blue = buildAlliance("blue", match.blue, matchEntries, input.accuracyThreshold, input.practice);

    const redTotal = red.scoutedTotal;
    const blueTotal = blue.scoutedTotal;
    const redFraction = redTotal !== null && blueTotal !== null ? (redTotal + blueTotal === 0 ? 0.5 : redTotal / (redTotal + blueTotal)) : null;

    return {
      key,
      match,
      label: formatMatch(match),
      red,
      blue,
      robotsScouted: red.scoutedCount + blue.scoutedCount,
      robotsTotal: match.red.teams.length + match.blue.teams.length,
      scouted: red.scoutedCount + blue.scoutedCount > 0,
      ...decideWinner(match, red, blue),
      redFraction,
    };
  });

  return rows.sort((a, b) => matchSortValue(a.match) - matchSortValue(b.match) || a.match.eventCode.localeCompare(b.match.eventCode));
}

/** Team-number search over both alliances (empty query matches everything). */
export function matchHasTeam(breakdown: Pick<MatchBreakdown, "match">, query: string): boolean {
  const q = query.trim();
  if (q === "") return true;
  return [...breakdown.match.red.teams, ...breakdown.match.blue.teams].some((t) => String(t).includes(q));
}

// --- what to show for one scouted robot --------------------------------------

export type EntrySummary = {
  /** Counter fields summed by game element: "Hive ×3". Only elements the robot actually scored on. */
  counts: { label: string; count: number }[];
  /** Toggles that were on ("Leave", "Park (endgame)") — the phase is added only when a label repeats. */
  toggles: string[];
  /** Checkbox incidents that were on ("Died During Match", "Yellow Card"). */
  incidents: string[];
};

/** Schema-driven: key game-element counts, toggles, and incidents for one entry. */
export function summarizeEntry(entry: AnalyticsEntry, schema: Form): EntrySummary {
  const meta = schemaFieldMeta(schema);
  const values = entryValues(entry, schema);
  const value = (key: string) => values[key];

  const counts = new Map<string, number>();
  for (const m of meta) {
    if (m.field.type !== "counter") continue;
    const n = value(m.field.key);
    if (typeof n !== "number" || n <= 0) continue;
    const element = elementOf(m);
    counts.set(element, (counts.get(element) ?? 0) + n);
  }

  const toggleFields = meta.filter((m) => m.field.type === "toggle");
  const labelCounts = new Map<string, number>();
  for (const m of toggleFields) labelCounts.set(m.field.label, (labelCounts.get(m.field.label) ?? 0) + 1);
  const toggles = toggleFields
    .filter((m) => value(m.field.key) === true)
    .map((m) => ((labelCounts.get(m.field.label) ?? 0) > 1 && m.phase ? `${m.field.label} (${m.phase})` : m.field.label));

  const incidents = meta.filter((m) => m.field.type === "checkbox" && value(m.field.key) === true).map((m) => m.field.label);

  return { counts: [...counts.entries()].map(([label, count]) => ({ label, count })), toggles, incidents };
}
