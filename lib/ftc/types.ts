export type EventLifecycleStatus = "upcoming" | "in-progress" | "completed";

export type FtcEvent = {
  code: string;
  season: number;
  name: string;
  dateStart: string;
  dateEnd: string;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  venue: string | null;
  website: string | null;
  timezone: string | null;
  status: EventLifecycleStatus;
};

export type FtcTeam = {
  teamNumber: number;
  nameShort: string;
  nameFull: string;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  rookieYear: number | null;
};

/** One row of an event's official qualification rankings (FIRST API `/rankings/{eventCode}`). */
export type FtcRanking = {
  teamNumber: number;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  matchesPlayed: number;
  /** Ranking points (the FIRST API's primary sort value, `sortOrder1`); null if the API didn't give one. Unverified against the live API — see docs/ASSUMPTIONS.md (P12). */
  rankingPoints: number | null;
};

export type MatchType = "Practice" | "Qualification" | "Playoff";

export type FtcMatch = {
  id: string;
  matchNumber: number;
  type: MatchType;
  description: string | null;
  series: number | null;
  played: boolean;
  redTeams: number[];
  blueTeams: number[];
  redScore: number | null;
  blueScore: number | null;
  // Points awarded to this alliance for fouls committed by the opponent —
  // already folded into redScore/blueScore, but exposed separately since the
  // accuracy formula compares them against scouted robot totals on their own.
  redPenaltyPoints: number | null;
  bluePenaltyPoints: number | null;
  startTime: string | null;
};

export type BracketAlliance = {
  seed: number | null;
  teams: number[];
};

export type BracketMatch = {
  label: string;
  match: FtcMatch | null;
  red: BracketAlliance | null;
  blue: BracketAlliance | null;
  winner: "red" | "blue" | null;
};

export type BracketRound = {
  label: string;
  round: number;
  matches: BracketMatch[];
};

export type BracketStructure =
  | {
      format: "double-elim-8";
      upperBracket: BracketRound[];
      lowerBracket: BracketRound[];
      finals: BracketMatch[];
    }
  | {
      format: "unknown";
      matches: FtcMatch[];
    };

export type EventSummaryCounts = {
  teamCount: number;
  qualMatchesScheduled: number;
  qualMatchesPlayed: number;
  playoffMatchesScheduled: number;
  playoffMatchesPlayed: number;
};

export type ActionErrorCode =
  | "missing_credentials"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "upstream_error"
  | "network_error";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
