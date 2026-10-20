"use server";

import { getDefaultSeason } from "./config";
import { ftcFetch, FtcApiError } from "./http";
import { buildPlayoffBracket } from "./bracket";
import type {
  ActionResult,
  BracketStructure,
  EventLifecycleStatus,
  FtcEvent,
  FtcMatch,
  FtcTeam,
  MatchType,
} from "./types";

// --- Raw FIRST API response shapes (only the fields we use) ---------------

type RawEvent = {
  code: string;
  name: string;
  dateStart: string;
  dateEnd: string;
  city?: string | null;
  stateprov?: string | null;
  country?: string | null;
  venue?: string | null;
  website?: string | null;
  timezone?: string | null;
};

type RawTeam = {
  teamNumber: number;
  nameShort?: string;
  nameFull?: string;
  city?: string | null;
  stateProv?: string | null;
  country?: string | null;
  rookieYear?: number | null;
};

type RawMatchTeam = {
  teamNumber: number;
  station: string;
};

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

/**
 * FIRST's API numbers matches inconsistently depending on tournament level:
 * for Qualification, `matchNumber` (1, 2, 3, ...) is the unique sequential
 * id and `series` is always 0. For Playoff, it's inverted — `matchNumber` is
 * always 1 (it identifies the game *within* a series) and `series` (1, 2,
 * 3, ...) is the actual sequential match slot shown in the match
 * description ("...Match 7"). Verified against real event data. This
 * resolves it to a single "which match is this" number regardless of type.
 */
function sequenceNumber(type: MatchType, raw: { matchNumber: number; series?: number | null }): number {
  return type === "Playoff" ? raw.series ?? raw.matchNumber : raw.matchNumber;
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof FtcApiError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    return { ok: false, error: { code: "upstream_error", message: "Unexpected error talking to the FIRST API." } };
  }
}

function eventStatus(dateStart: string, dateEnd: string): EventLifecycleStatus {
  const now = Date.now();
  const start = new Date(dateStart).getTime();
  // dateEnd from the API is a date (no time) — treat it as end-of-day.
  const end = new Date(dateEnd).getTime() + 24 * 60 * 60 * 1000 - 1;
  if (now < start) return "upcoming";
  if (now > end) return "completed";
  return "in-progress";
}

function toFtcEvent(raw: RawEvent, season: number): FtcEvent {
  return {
    code: raw.code,
    season,
    name: raw.name,
    dateStart: raw.dateStart,
    dateEnd: raw.dateEnd,
    city: raw.city ?? null,
    stateProv: raw.stateprov ?? null,
    country: raw.country ?? null,
    venue: raw.venue ?? null,
    website: raw.website ?? null,
    timezone: raw.timezone ?? null,
    status: eventStatus(raw.dateStart, raw.dateEnd),
  };
}

function toFtcTeam(raw: RawTeam): FtcTeam {
  return {
    teamNumber: raw.teamNumber,
    nameShort: raw.nameShort ?? `Team ${raw.teamNumber}`,
    nameFull: raw.nameFull ?? raw.nameShort ?? `Team ${raw.teamNumber}`,
    city: raw.city ?? null,
    stateProv: raw.stateProv ?? null,
    country: raw.country ?? null,
    rookieYear: raw.rookieYear ?? null,
  };
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

// --- Public API --------------------------------------------------------

export async function getEvents(params?: { season?: number; search?: string }): Promise<ActionResult<FtcEvent[]>> {
  const season = params?.season ?? getDefaultSeason();
  return run(async () => {
    const res = await ftcFetch<{ events: RawEvent[] }>(`/${season}/events`);
    let events = res.events.map((e) => toFtcEvent(e, season));
    const search = params?.search?.trim().toLowerCase();
    if (search) {
      events = events.filter(
        (e) => e.name.toLowerCase().includes(search) || e.code.toLowerCase().includes(search)
      );
    }
    return events.sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  });
}

export async function getEvent(eventCode: string, season?: number): Promise<ActionResult<FtcEvent | null>> {
  const resolvedSeason = season ?? getDefaultSeason();
  return run(async () => {
    const res = await ftcFetch<{ events: RawEvent[] }>(`/${resolvedSeason}/events`, { eventCode });
    const found = res.events[0];
    return found ? toFtcEvent(found, resolvedSeason) : null;
  });
}

export async function getTeamsForEvent(eventCode: string, season?: number): Promise<ActionResult<FtcTeam[]>> {
  const resolvedSeason = season ?? getDefaultSeason();
  return run(async () => {
    const res = await ftcFetch<{ teams: RawTeam[] }>(`/${resolvedSeason}/teams`, { eventCode });
    return res.teams.map(toFtcTeam).sort((a, b) => a.teamNumber - b.teamNumber);
  });
}

const TOURNAMENT_LEVEL: Record<Exclude<MatchType, "Practice">, string> = {
  Qualification: "qual",
  Playoff: "playoff",
};

export async function getMatchesForEvent(
  eventCode: string,
  matchType: MatchType,
  season?: number
): Promise<ActionResult<FtcMatch[]>> {
  // FIRST's API only publishes official Qualification/Playoff results —
  // practice matches are informal and never tracked, so there's no endpoint
  // to call. Returning an empty list here (rather than guessing at a request
  // that will always 404) keeps the "not tracked" case distinct from a real
  // empty-schedule or error case for callers.
  if (matchType === "Practice") {
    return { ok: true, data: [] };
  }

  const resolvedSeason = season ?? getDefaultSeason();
  const tournamentLevel = TOURNAMENT_LEVEL[matchType];
  return run(async () => {
    // The `/matches` endpoint only returns matches that have actually been
    // played (verified against a live event) — it can't tell us how many are
    // *scheduled but not yet run*. `/schedule` has the full planned set (team
    // pairings, no scores) as soon as the draw/alliance selection happens, so
    // both are needed to show accurate "played vs scheduled" counts.
    const [scheduleRes, matchesRes] = await Promise.all([
      ftcFetch<{ schedule: RawScheduleItem[] }>(`/${resolvedSeason}/schedule/${eventCode}`, { tournamentLevel }),
      ftcFetch<{ matches: RawMatch[] }>(`/${resolvedSeason}/matches/${eventCode}`, { tournamentLevel }),
    ]);

    const resultsByKey = new Map(matchesRes.matches.map((m) => [sequenceNumber(matchType, m), m]));
    const scheduledKeys = new Set(scheduleRes.schedule.map((s) => sequenceNumber(matchType, s)));

    const fromSchedule = scheduleRes.schedule.map((s) =>
      toFtcMatch(matchType, s, resultsByKey.get(sequenceNumber(matchType, s)) ?? null)
    );
    // A played match with no matching schedule entry shouldn't be able to
    // happen, but surface it rather than silently drop a real result.
    const unscheduledResults = matchesRes.matches
      .filter((m) => !scheduledKeys.has(sequenceNumber(matchType, m)))
      .map((m) => toFtcMatch(matchType, null, m));

    return [...fromSchedule, ...unscheduledResults].sort((a, b) => a.matchNumber - b.matchNumber);
  });
}

export async function getPlayoffBracket(eventCode: string, season?: number): Promise<ActionResult<BracketStructure>> {
  const matches = await getMatchesForEvent(eventCode, "Playoff", season);
  if (!matches.ok) return matches;
  return { ok: true, data: buildPlayoffBracket(matches.data) };
}
