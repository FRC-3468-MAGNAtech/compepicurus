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
