"use server";

import { getDefaultSeason } from "./config";
import { ftcFetch, FtcApiError } from "./http";
import { fetchMatchesForEventInternal } from "./matches-internal";
import { buildPlayoffBracket } from "./bracket";
import { getEventStatus } from "./event-status";
import { requireUser } from "@/lib/server/require-user";
import type {
  ActionResult,
  BracketStructure,
  FtcEvent,
  FtcMatch,
  FtcRanking,
  FtcTeam,
  MatchType,
} from "./types";

const UNAUTHORIZED_RESULT = {
  ok: false as const,
  error: { code: "unauthorized" as const, message: "Sign in to view FIRST API data." },
};

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
    status: getEventStatus({ dateStart: raw.dateStart, dateEnd: raw.dateEnd, timezone: raw.timezone ?? null }),
  };
}

type RawRanking = {
  rank?: number;
  teamNumber?: number;
  wins?: number;
  losses?: number;
  ties?: number;
  matchesPlayed?: number;
  sortOrder1?: number;
  qualAverage?: number;
};

function toFtcRanking(raw: RawRanking): FtcRanking | null {
  if (typeof raw.teamNumber !== "number" || typeof raw.rank !== "number") return null;
  return {
    teamNumber: raw.teamNumber,
    rank: raw.rank,
    wins: raw.wins ?? 0,
    losses: raw.losses ?? 0,
    ties: raw.ties ?? 0,
    matchesPlayed: raw.matchesPlayed ?? (raw.wins ?? 0) + (raw.losses ?? 0) + (raw.ties ?? 0),
    // FTC ranks by ranking points (sortOrder1 in the v2.0 rankings payload); older payloads only carried qualAverage.
    rankingPoints: raw.sortOrder1 ?? raw.qualAverage ?? null,
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

// --- Public API --------------------------------------------------------

export async function getEvents(params?: { season?: number; search?: string }): Promise<ActionResult<FtcEvent[]>> {
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
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
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  const resolvedSeason = season ?? getDefaultSeason();
  return run(async () => {
    const res = await ftcFetch<{ events: RawEvent[] }>(`/${resolvedSeason}/events`, { eventCode });
    const found = res.events[0];
    return found ? toFtcEvent(found, resolvedSeason) : null;
  });
}

export async function getTeamsForEvent(eventCode: string, season?: number): Promise<ActionResult<FtcTeam[]>> {
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  const resolvedSeason = season ?? getDefaultSeason();
  return run(async () => {
    const res = await ftcFetch<{ teams: RawTeam[] }>(`/${resolvedSeason}/teams`, { eventCode });
    return res.teams.map(toFtcTeam).sort((a, b) => a.teamNumber - b.teamNumber);
  });
}

/**
 * Official qualification rankings (rank, win/loss/tie record, ranking points). Empty until
 * the event has played qualification matches; callers treat an error or an
 * empty list as "no official rank available" rather than a failure (Team
 * Profile just omits the rank chip).
 */
export async function getRankingsForEvent(eventCode: string, season?: number): Promise<ActionResult<FtcRanking[]>> {
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  const resolvedSeason = season ?? getDefaultSeason();
  return run(async () => {
    const res = await ftcFetch<{ rankings?: RawRanking[]; Rankings?: RawRanking[] }>(`/${resolvedSeason}/rankings/${eventCode}`);
    return (res.rankings ?? res.Rankings ?? []).map(toFtcRanking).filter((r): r is FtcRanking => r !== null);
  });
}

/**
 * The fetch+merge logic itself (schedule + results, FIRST's inconsistent
 * match-numbering across tournament levels, ...) now lives in
 * matches-internal.ts (P7) — app/api/cron/poll-live-scores and
 * app/api/live/check-scores need the exact same thing from a server
 * context with no user session to gate on, so only the auth gate stays
 * here.
 */
export async function getMatchesForEvent(eventCode: string, matchType: MatchType, season?: number): Promise<ActionResult<FtcMatch[]>> {
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return run(() => fetchMatchesForEventInternal(eventCode, matchType, season));
}

export async function getPlayoffBracket(eventCode: string, season?: number): Promise<ActionResult<BracketStructure>> {
  const matches = await getMatchesForEvent(eventCode, "Playoff", season);
  if (!matches.ok) return matches;
  return { ok: true, data: buildPlayoffBracket(matches.data) };
}
