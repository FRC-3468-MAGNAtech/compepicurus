import { getStatus } from "@/lib/accuracy/engine";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import { formatMatch, matchSortValue } from "@/lib/analytics/game-schema";
import type { AllianceColor, OfficialMatch } from "@/lib/analytics/match-breakdown";
import { buildKeyStats } from "@/lib/analytics/team-card";
import type { TeamStats } from "@/lib/analytics/team-stats";
import type { AssignmentsDoc } from "@/lib/assignments";
import type { Record3 } from "@/lib/dashboard/schedule";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import type { ScoutFormSchema } from "@/lib/scout-form/schema";

// Pure calculations behind the role dashboards' widgets (P13). Nothing here
// invents data: every figure comes from entries, official matches, rankings,
// or stats the app already has, and a widget hides itself when the input
// isn't there. All thresholds are named constants so they're easy to tune.

// --- scouting coverage ----------------------------------------------------------

export type MatchCoverage = {
  /** Played Qualification/Playoff matches with a full roster. */
  playedMatches: number;
  /** Of those, matches where all robots have a scout entry. */
  fullyScouted: number;
  /** 0-100, or null before any match has been played. */
  percent: number | null;
  /** Matches missing at least one robot, in the order given. */
  missing: { key: string; label: string; missingTeams: number[] }[];
};

const isRealEventEntry = (e: ScoutEntry) => e.source === "event" && !e.excluded;

/**
 * "Percent of completed matches with all robots scouted" and which robots are
 * missing from the rest. Only real-event entries count (practice entries never
 * stand in for a real match), and excluded entries don't.
 */
export function computeCoverage(matches: OfficialMatch[], entries: ScoutEntry[]): MatchCoverage {
  const scouted = new Set<string>();
  for (const e of entries) {
    if (isRealEventEntry(e)) scouted.add(`${e.eventCode}|${e.matchType}|${e.matchNumber}|${e.teamNumber}`);
  }

  let played = 0;
  let full = 0;
  const missing: MatchCoverage["missing"] = [];
  for (const m of matches) {
    const teams = [...m.red.teams, ...m.blue.teams];
    if (!m.played || m.matchType === "Practice" || teams.length === 0) continue;
    played += 1;
    const gone = teams.filter((t) => !scouted.has(`${m.eventCode}|${m.matchType}|${m.matchNumber}|${t}`));
    if (gone.length === 0) full += 1;
    else missing.push({ key: `${m.eventCode}|${m.matchType}|${m.matchNumber}`, label: formatMatch(m), missingTeams: gone });
  }
  return { playedMatches: played, fullyScouted: full, percent: played === 0 ? null : Math.round((full / played) * 100), missing };
}

export type TeamCoverage = { total: number; scouted: number; percent: number | null; zero: number[] };

/** Teams at the event with at least one entry, and the list with none. */
export function computeTeamCoverage(teamNumbers: number[], entries: ScoutEntry[]): TeamCoverage {
  const seen = new Set(entries.filter(isRealEventEntry).map((e) => e.teamNumber));
  const unique = [...new Set(teamNumbers)].sort((a, b) => a - b);
  const zero = unique.filter((t) => !seen.has(t));
  return { total: unique.length, scouted: unique.length - zero.length, percent: unique.length === 0 ? null : Math.round(((unique.length - zero.length) / unique.length) * 100), zero };
}

// --- review queues ----------------------------------------------------------------

/** Entries with an automatic flag nobody has dismissed yet — "awaiting review". Newest first; excluded entries are already handled. */
export function flaggedEntries<T extends ScoutEntry>(entries: T[]): T[] {
  return entries
    .filter((e) => !e.excluded && e.autoFlags.some((f) => !f.dismissed))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export type StatusBand = { id: string; label: string; count: number };

/** Counts of scouts per accuracy status band, in worst-to-best order, plus how many have no rating yet. */
export function countByStatus(rows: { status: { id: string } | null }[]): { bands: StatusBand[]; unrated: number } {
  // The four tiers, via the engine's own getStatus() so labels can't drift.
  const tiers = [25, 60, 80, 95].map((acc) => getStatus(acc));
  const bands: StatusBand[] = tiers.map((t) => ({ id: t.id, label: t.label, count: 0 }));
  let unrated = 0;
  for (const r of rows) {
    const band = r.status ? bands.find((b) => b.id === r.status!.id) : undefined;
    if (band) band.count += 1;
    else unrated += 1;
  }
  return { bands, unrated };
}

export type AssignmentStatus = { published: boolean; slotCount: number; unassigned: string[] };

/** Is the schedule published, and which attending members have no slot in it. */
export function assignmentStatus(assignments: AssignmentsDoc | null, attendingUids: string[], members: { uid: string; name: string }[]): AssignmentStatus {
  const current = assignments?.current ?? null;
  if (!current) return { published: false, slotCount: 0, unassigned: [] };
  const assigned = new Set(current.slots.map((s) => s.scoutUid).filter((u): u is string => u !== null));
  const byUid = new Map(members.map((m) => [m.uid, m.name]));
  const unassigned = attendingUids.filter((u) => !assigned.has(u)).map((u) => byUid.get(u) ?? "Unknown member");
  return { published: true, slotCount: current.slots.length, unassigned };
}

/**
 * A scout's next assignment: the first slot assigned to them, in match order,
 * that they haven't already submitted an entry for. `myEntries` is any list of
 * this scout's entries; only real-event ones for `eventCode` count.
 * (The Match Scout Form's "Next assignment" uses the same rule.)
 */
export function nextAssignment(
  slots: ScheduleSlot[],
  uid: string,
  eventCode: string,
  myEntries: Pick<ScoutEntry, "uid" | "source" | "eventCode" | "matchType" | "matchNumber" | "teamNumber">[]
): ScheduleSlot | null {
  const mine = slots.filter((s) => s.scoutUid === uid).sort((a, b) => matchSortValue(a) - matchSortValue(b));
  return (
    mine.find(
      (s) =>
        !myEntries.some(
          (e) => e.uid === uid && e.source === "event" && e.eventCode === eventCode && e.matchType === s.matchType && e.matchNumber === s.matchNumber && e.teamNumber === s.teamNumber
        )
    ) ?? null
  );
}

/** Practice sessions (any kind) with a flag nobody has dismissed yet and not excluded from stats — the admin strip's "flagged sessions". */
export function countFlaggedSessions(sessions: Pick<PracticeSession, "flags" | "excluded">[]): number {
  return sessions.filter((s) => !s.excluded && s.flags.some((f) => !f.dismissed)).length;
}

/** Completed practice/live/lobby sessions that finished in the last `days` days, and how many scouts did them. */
export function practiceActivity(sessions: PracticeSession[], nowMs: number, days: number = 7): { sessions: number; scouts: number } {
  const since = nowMs - days * 86_400_000;
  const recent = sessions.filter((s) => s.status === "completed" && !s.excluded && Date.parse(s.finishedAt ?? s.startedAt) >= since);
  return { sessions: recent.length, scouts: new Set(recent.map((s) => s.uid)).size };
}

// --- data confidence / comparisons ------------------------------------------------------

/** Mean alliance accuracy (0-100) over the entries that have one. */
export function averageAccuracy(entries: Pick<AnalyticsEntry, "allianceAccuracy">[]): number | null {
  const values = entries.map((e) => e.allianceAccuracy).filter((a): a is number => a !== null);
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

export type PhaseAverages = { auto: number; teleop: number; endgame: number };

/** Mean auto / teleop / endgame points per scout entry — "the event average" our own phases are compared with. */
export function phaseAverages(entries: Pick<ScoutEntry, "score">[]): PhaseAverages | null {
  if (entries.length === 0) return null;
  const mean = (pick: (s: ScoutEntry["score"]) => number) => entries.reduce((sum, e) => sum + pick(e.score), 0) / entries.length;
  return { auto: mean((s) => s.auto), teleop: mean((s) => s.teleop), endgame: mean((s) => s.endgame) };
}

// --- hidden gems -----------------------------------------------------------------------

/** A "hidden gem" is scouted this many places (or this fraction of the field, whichever is larger) better than official rank. */
export const HIDDEN_GEM_MIN_GAP = 5;
export const HIDDEN_GEM_GAP_FRACTION = 0.2;
export const HIDDEN_GEM_MIN_ENTRIES = 2;

export type HiddenGem = { teamNumber: number; teamName: string | null; officialRank: number; scoutedRank: number; gap: number; entryCount: number };

/**
 * Teams whose scouted rank is much better than their official rank — strong
 * robots the standings haven't caught up to (bad schedule luck, a slow start).
 * Needs both ranks and a real sample; biggest gap first.
 */
export function findHiddenGems(input: {
  teams: { teamNumber: number; teamName: string | null; officialRank: number | null; scoutedRank: number | null; entryCount: number }[];
  fieldSize: number;
  limit?: number;
}): HiddenGem[] {
  const needed = Math.max(HIDDEN_GEM_MIN_GAP, Math.ceil(input.fieldSize * HIDDEN_GEM_GAP_FRACTION));
  return input.teams
    .flatMap((t) => {
      if (t.officialRank === null || t.scoutedRank === null || t.entryCount < HIDDEN_GEM_MIN_ENTRIES) return [];
      const gap = t.officialRank - t.scoutedRank;
      return gap >= needed ? [{ teamNumber: t.teamNumber, teamName: t.teamName, officialRank: t.officialRank, scoutedRank: t.scoutedRank, gap, entryCount: t.entryCount }] : [];
    })
    .sort((a, b) => b.gap - a.gap || a.teamNumber - b.teamNumber)
    .slice(0, input.limit ?? 5);
}

// --- strength bullets (Judge Awards) ----------------------------------------------------

/** Stat-based bullets need at least this many of our own scouted entries. */
export const STRENGTH_MIN_ENTRIES = 3;
export const STRENGTH_RATE_AT = 80;
export const STRENGTH_RELIABLE_AT = 90;
export const STRENGTH_CONSISTENT_AT = 80;

/**
 * Auto-generated talking points from our own numbers. Each bullet is only
 * produced when it's true — nothing is padded or implied — so an early-event
 * team simply gets fewer bullets (or none).
 */
export function strengthBullets(input: {
  stats: TeamStats | null;
  schema: ScoutFormSchema;
  scoutedRank: number | null;
  fieldSize: number;
  officialRank: number | null;
  record: Record3 | null;
}): string[] {
  const { stats, schema, scoutedRank, fieldSize, officialRank, record } = input;
  const bullets: string[] = [];

  if (officialRank !== null && officialRank <= 3) bullets.push(`Ranked #${officialRank} in the official standings`);
  if (record && record.wins > record.losses && record.wins + record.losses + record.ties >= 2) {
    bullets.push(`Winning record (${record.wins}-${record.losses}-${record.ties})`);
  }

  if (!stats || stats.entryCount < STRENGTH_MIN_ENTRIES) return bullets;

  if (scoutedRank !== null) {
    if (scoutedRank <= 3) bullets.push("Top 3 scouted average at this event");
    else if (fieldSize >= 8 && scoutedRank <= Math.ceil(fieldSize * 0.25)) bullets.push("Top 25% scouted average at this event");
  }

  const rates = buildKeyStats(stats, schema)
    .rates.filter((r) => r.rate >= STRENGTH_RATE_AT)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3);
  for (const r of rates) bullets.push(`${r.label} rate ${Math.round(r.rate)}%`);

  if (stats.reliability !== null && stats.reliability >= STRENGTH_RELIABLE_AT) {
    bullets.push(`Reliable — no robot failures in ${Math.round(stats.reliability)}% of matches`);
  }
  if (stats.entryCount >= STRENGTH_MIN_ENTRIES && stats.consistency >= STRENGTH_CONSISTENT_AT) {
    bullets.push(`Consistent scoring (${Math.round(stats.consistency)}% consistency)`);
  }
  if (stats.trend.direction === "up") {
    bullets.push(`Scoring trending up (+${stats.trend.delta.toFixed(1)} over the last ${stats.trend.recentCount} matches)`);
  }
  return bullets;
}

// --- event highlights (Media) ---------------------------------------------------------

export type EventHighlights = {
  highest: { score: number; label: string; color: AllianceColor; teams: number[] } | null;
  ourBest: { score: number; label: string; color: AllianceColor } | null;
};

/** The event's highest official alliance score, and our own best match. Played Qualification/Playoff matches only. */
export function eventHighlights(matches: OfficialMatch[], ourTeam: number | null): EventHighlights {
  let highest: EventHighlights["highest"] = null;
  let ourBest: EventHighlights["ourBest"] = null;
  for (const m of matches) {
    if (!m.played || m.matchType === "Practice") continue;
    for (const color of ["red", "blue"] as const) {
      const side = m[color];
      if (side.score === null) continue;
      if (!highest || side.score > highest.score) highest = { score: side.score, label: formatMatch(m), color, teams: side.teams };
      if (ourTeam !== null && side.teams.includes(ourTeam) && (!ourBest || side.score > ourBest.score)) {
        ourBest = { score: side.score, label: formatMatch(m), color };
      }
    }
  }
  return { highest, ourBest };
}
