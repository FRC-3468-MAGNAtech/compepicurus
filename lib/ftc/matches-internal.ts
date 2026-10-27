import "server-only";
import { getDefaultSeason } from "./config";
import { ftcFetch } from "./http";
import type { FtcMatch, MatchType } from "./types";

// Extracted from lib/ftc/actions.ts's getMatchesForEvent (P7) — that
// function's own requireUser() gate only makes sense for a user-facing
// page; app/api/cron/poll-live-scores and app/api/live/check-scores need
// the identical fetch+merge logic from a trusted server context that has
// no user session to gate on (a CRON_SECRET bearer token and a
// signed-in-but-unrelated-to-the-match-data check, respectively). This
// file holds the actual logic once; both the public Server Action and
// those two routes call it.

type RawMatchTeam = { teamNumber: number; station: string };

type RawMatch = {
  matchNumber: number;
  description?: string | null;
  series?: number | null;
  actualStartTime?: string | null;
  scoreRedFinal?: number | null;
  scoreBlueFinal?: number | null;
  scoreRedFoul?: number | null;
  scoreBlueFoul?: number | null;
  postResultTime?: string | null;
  teams: RawMatchTeam[];
};

type RawScheduleItem = {
  matchNumber: number;
  description?: string | null;
  series?: number | null;
  startTime?: string | null;
  teams: RawMatchTeam[];
};

const TOURNAMENT_LEVEL: Record<Exclude<MatchType, "Practice">, string> = {
  Qualification: "qual",
  Playoff: "playoff",
};

/**
 * FIRST's API numbers matches inconsistently depending on tournament level:
 * for Qualification, `matchNumber` (1, 2, 3, ...) is the unique sequential
 * id and `series` is always 0. For Playoff, it's inverted — `matchNumber` is
 * always 1 (it identifies the game within a series) and `series` (1, 2,
 * 3, ...) is the actual sequential match slot shown in the match
 * description ("...Match 7"). Verified against real event data. This
 * resolves it to a single "which match is this" number regardless of type.
 */
function sequenceNumber(type: MatchType, raw: { matchNumber: number; series?: number | null }): number {
  return type === "Playoff" ? (raw.series ?? raw.matchNumber) : raw.matchNumber;
}

/**
 * Builds one FtcMatch from the two sources that can describe it: the
 * pre-match `schedule` entry (team pairings, published once the draw/alliance
 * selection happens — absent for matches not yet scheduled) and the `match`
 * result (present only once the match has actually been played). At least
 * one of the two is always provided by the caller.
 */
function toFtcMatch(type: MatchType, schedule: RawScheduleItem | null, match: RawMatch | null): FtcMatch {
  const source = schedule ?? match!;
  const teamsSource = schedule?.teams ?? match?.teams ?? [];
  const redTeams = teamsSource.filter((t) => t.station.startsWith("Red")).map((t) => t.teamNumber);
  const blueTeams = teamsSource.filter((t) => t.station.startsWith("Blue")).map((t) => t.teamNumber);
  const played = match?.scoreRedFinal !== null && match?.scoreRedFinal !== undefined;
  return {
    id: `${type}-${sequenceNumber(type, source)}`,
    matchNumber: sequenceNumber(type, source),
    type,
    description: source.description ?? null,
    series: source.series ?? null,
    played,
    redTeams,
    blueTeams,
    redScore: match?.scoreRedFinal ?? null,
    blueScore: match?.scoreBlueFinal ?? null,
    redPenaltyPoints: match?.scoreRedFoul ?? null,
    bluePenaltyPoints: match?.scoreBlueFoul ?? null,
    startTime: schedule?.startTime ?? match?.actualStartTime ?? null,
  };
}

/** Throws `FtcApiError` on failure — callers decide how to translate that (an `ActionResult` for the user-facing action, a plain catch for the server routes). */
export async function fetchMatchesForEventInternal(eventCode: string, matchType: MatchType, season?: number): Promise<FtcMatch[]> {
  // FIRST's API only publishes official Qualification/Playoff results —
  // practice matches are informal and never tracked.
  if (matchType === "Practice") return [];

  const resolvedSeason = season ?? getDefaultSeason();
  const tournamentLevel = TOURNAMENT_LEVEL[matchType];

  const [scheduleRes, matchesRes] = await Promise.all([
    ftcFetch<{ schedule: RawScheduleItem[] }>(`/${resolvedSeason}/schedule/${eventCode}`, { tournamentLevel }),
    ftcFetch<{ matches: RawMatch[] }>(`/${resolvedSeason}/matches/${eventCode}`, { tournamentLevel }),
  ]);

  const resultsByKey = new Map(matchesRes.matches.map((m) => [sequenceNumber(matchType, m), m]));
  const scheduledKeys = new Set(scheduleRes.schedule.map((s) => sequenceNumber(matchType, s)));

  const fromSchedule = scheduleRes.schedule.map((s) => toFtcMatch(matchType, s, resultsByKey.get(sequenceNumber(matchType, s)) ?? null));
  const unscheduledResults = matchesRes.matches
    .filter((m) => !scheduledKeys.has(sequenceNumber(matchType, m)))
    .map((m) => toFtcMatch(matchType, null, m));

  return [...fromSchedule, ...unscheduledResults].sort((a, b) => a.matchNumber - b.matchNumber);
}
