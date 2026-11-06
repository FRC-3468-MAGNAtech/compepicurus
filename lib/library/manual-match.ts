import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { getDifficulty, type Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/ftc/types";
import { libraryMatchId, parseMatchType } from "@/lib/library/ids";
import { LONG_CLIP_SECONDS, formatTime, parseTimeInput, validateVideoWindow } from "@/lib/library/time";
import { canonicalYouTubeUrl, parseYouTubeUrl } from "@/lib/library/youtube-url";
import type { LibraryMatch } from "@/lib/match-library";

// Validation and document-building for hand-entered library matches (P15).
// Pure: the single form, the fast-entry row, and the CSV/paste import all
// produce a RawMatch (everything still a string) and go through the same
// validateRawMatch(), so a rule is written once.

export type RawMatch = {
  matchType: string;
  matchNumber: string;
  red1: string;
  red2: string;
  blue1: string;
  blue2: string;
  redScore: string;
  blueScore: string;
  redPenalty: string;
  bluePenalty: string;
  youtubeUrl: string;
  start: string;
  end: string;
  notes: string;
};

export type RawField = keyof RawMatch;

export const emptyRawMatch = (): RawMatch => ({
  matchType: "Q",
  matchNumber: "",
  red1: "",
  red2: "",
  blue1: "",
  blue2: "",
  redScore: "",
  blueScore: "",
  redPenalty: "",
  bluePenalty: "",
  youtubeUrl: "",
  start: "",
  end: "",
  notes: "",
});

export type ManualAlliance = { teams: [number, number]; score: number; penaltyPoints: number };

export type ValidMatch = {
  matchType: MatchType;
  matchNumber: number;
  red: ManualAlliance;
  blue: ManualAlliance;
  /** Null when no link was given (admins can add the video later). The times are optional: null = blank (see lib/library/video-window.ts). */
  video: { youtubeUrl: string; startSec: number | null; endSec: number | null } | null;
  notes: string;
};

export type FieldErrors = Partial<Record<RawField, string>>;

export const MAX_NOTES = 500;
export const MAX_MATCH_NUMBER = 9999;
export const MAX_SCORE = 9999;

export type ValidateOptions = {
  /** The event's default video, used when a row has no link of its own. */
  defaultVideoUrl?: string | null;
  /** Used when `matchType` is blank (CSV/paste event defaults). */
  defaultMatchType?: MatchType | null;
};

function parseWhole(value: string, max: number): number | null {
  const t = value.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

/** All of a row's checks. `match` is set only when `ok`. */
export function validateRawMatch(raw: RawMatch, options: ValidateOptions = {}): { ok: boolean; errors: FieldErrors; match: ValidMatch | null } {
  const errors: FieldErrors = {};

  // Match type + number
  const typeText = raw.matchType.trim();
  const matchType = typeText === "" ? (options.defaultMatchType ?? null) : parseMatchType(typeText);
  if (!matchType) errors.matchType = typeText === "" ? "Pick a match type (P, Q, or F)." : "Match type must be P, Q, or F.";
  const matchNumber = parseWhole(raw.matchNumber, MAX_MATCH_NUMBER);
  if (matchNumber === null || matchNumber < 1) errors.matchNumber = `Enter a match number from 1 to ${MAX_MATCH_NUMBER}.`;

  // Teams: 1-5 digits, all four distinct
  const teamFields = ["red1", "red2", "blue1", "blue2"] as const;
  const teams: Partial<Record<(typeof teamFields)[number], number>> = {};
  for (const field of teamFields) {
    const t = raw[field].trim();
    if (!/^\d{1,5}$/.test(t) || Number(t) < 1) errors[field] = "Use a team number of 1-5 digits.";
    else teams[field] = Number(t);
  }
  const seen = new Map<number, (typeof teamFields)[number]>();
  for (const field of teamFields) {
    const n = teams[field];
    if (n === undefined) continue;
    if (seen.has(n)) {
      errors[field] ??= `Team ${n} is already in this match — all four teams must be different.`;
    } else seen.set(n, field);
  }

  // Scores and penalty points (penalty is part of the score, so it can't exceed it)
  const scoreOf = (value: string, label: string, field: RawField): number | null => {
    const n = parseWhole(value, MAX_SCORE);
    if (n === null) errors[field] = `${label} must be a whole number from 0 to ${MAX_SCORE}.`;
    return n;
  };
  const redScore = scoreOf(raw.redScore, "The red score", "redScore");
  const blueScore = scoreOf(raw.blueScore, "The blue score", "blueScore");
  // A blank penalty means 0 (event default).
  const penaltyOf = (value: string, label: string, field: RawField): number | null => {
    if (value.trim() === "") return 0;
    const n = parseWhole(value, MAX_SCORE);
    if (n === null) errors[field] = `${label} must be a whole number, 0 or more.`;
    return n;
  };
  const redPenalty = penaltyOf(raw.redPenalty, "Red penalty points", "redPenalty");
  const bluePenalty = penaltyOf(raw.bluePenalty, "Blue penalty points", "bluePenalty");
  if (redScore !== null && redPenalty !== null && redPenalty > redScore) {
    errors.redPenalty = "Penalty points are already part of the score, so they can't be more than it.";
  }
  if (blueScore !== null && bluePenalty !== null && bluePenalty > blueScore) {
    errors.bluePenalty = "Penalty points are already part of the score, so they can't be more than it.";
  }

  // Notes
  if (raw.notes.length > MAX_NOTES) errors.notes = `Keep notes under ${MAX_NOTES} characters.`;

  // Video: the row's link, else the event default. No link at all is fine.
  let video: ValidMatch["video"] = null;
  const urlText = raw.youtubeUrl.trim() || (options.defaultVideoUrl ?? "").trim();
  if (urlText !== "") {
    const parsed = parseYouTubeUrl(urlText);
    if (!parsed) {
      errors.youtubeUrl = "That doesn't look like a YouTube link.";
    } else {
      // FIX3: both times are optional. Blank start = the beginning (a `t=` in the link pre-fills it); blank end = the match ends with the video.
      const startText = raw.start.trim();
      const endText = raw.end.trim();
      const startSec = startText === "" ? (parsed.startSec ?? null) : parseTimeInput(startText);
      const endSec = endText === "" ? null : parseTimeInput(endText);
      if (startText !== "" && startSec === null) errors.start = "Use seconds (90), 1:30, or 1:02:30 — or leave it blank.";
      if (endText !== "" && endSec === null) errors.end = "Use seconds (150), 2:30, or 1:02:30 — or leave it blank.";
      if (!errors.start && !errors.end) {
        // Only compare the two when both are there; an end on its own just has to be after the beginning (0).
        const windowError = endSec === null ? null : validateVideoWindow(startSec ?? 0, endSec);
        if (windowError) errors.end = windowError;
        else video = { youtubeUrl: canonicalYouTubeUrl(parsed.videoId), startSec, endSec };
      }
    }
  }

  const ok = Object.keys(errors).length === 0;
  if (!ok || !matchType || matchNumber === null || redScore === null || blueScore === null || redPenalty === null || bluePenalty === null) {
    return { ok: false, errors, match: null };
  }
  return {
    ok: true,
    errors,
    match: {
      matchType,
      matchNumber,
      red: { teams: [teams.red1!, teams.red2!], score: redScore, penaltyPoints: redPenalty },
      blue: { teams: [teams.blue1!, teams.blue2!], score: blueScore, penaltyPoints: bluePenalty },
      video,
      notes: raw.notes.trim(),
    },
  };
}

/** A stored/validated match back to the strings a form edits. */
export function matchToRaw(m: {
  matchType: MatchType;
  matchNumber: number;
  alliances: { red: { teams: number[]; score: number; penaltyPoints: number }; blue: { teams: number[]; score: number; penaltyPoints: number } };
  video: { youtubeUrl: string; startSec?: number | null; endSec?: number | null } | null;
  notes?: string;
}): RawMatch {
  return {
    matchType: MATCH_TYPE_PREFIX[m.matchType],
    matchNumber: String(m.matchNumber),
    red1: String(m.alliances.red.teams[0] ?? ""),
    red2: String(m.alliances.red.teams[1] ?? ""),
    blue1: String(m.alliances.blue.teams[0] ?? ""),
    blue2: String(m.alliances.blue.teams[1] ?? ""),
    redScore: String(m.alliances.red.score),
    blueScore: String(m.alliances.blue.score),
    redPenalty: String(m.alliances.red.penaltyPoints),
    bluePenalty: String(m.alliances.blue.penaltyPoints),
    youtubeUrl: m.video?.youtubeUrl ?? "",
    start: m.video && typeof m.video.startSec === "number" ? formatTime(m.video.startSec) : "",
    end: m.video && typeof m.video.endSec === "number" ? formatTime(m.video.endSec) : "",
    notes: m.notes ?? "",
  };
}

/** A stored library match as the validated shape (for sanity checks against the event's other matches). */
export function libraryMatchToValid(m: LibraryMatch): ValidMatch {
  const side = (a: LibraryMatch["alliances"]["red"]): ManualAlliance => ({ teams: [a.teams[0] ?? 0, a.teams[1] ?? 0], score: a.score, penaltyPoints: a.penaltyPoints });
  return { matchType: m.matchType, matchNumber: m.matchNumber, red: side(m.alliances.red), blue: side(m.alliances.blue), video: m.video ? { youtubeUrl: m.video.youtubeUrl, startSec: m.video.startSec ?? null, endSec: m.video.endSec ?? null } : null, notes: m.notes ?? "" };
}

/** The next free match number of a type — what "Save and add next" fills in. */
export function nextMatchNumber(matches: Pick<LibraryMatch, "matchType" | "matchNumber">[], matchType: MatchType): number {
  return matches.filter((m) => m.matchType === matchType).reduce((max, m) => Math.max(max, m.matchNumber), 0) + 1;
}

export const matchLabel = (m: Pick<ValidMatch, "matchType" | "matchNumber">): string => `${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`;

export type EventRef = { eventCode: string; eventName: string; seasonId: string };

export function manualMatchId(event: Pick<EventRef, "eventCode">, m: Pick<ValidMatch, "matchType" | "matchNumber">): string {
  return libraryMatchId(event.eventCode, m.matchType, m.matchNumber);
}

type AllianceDoc = { teams: number[]; score: number; penaltyPoints: number; difficulty: Difficulty };

/**
 * The content fields of a manual `libraryMatches` doc. Difficulty is computed
 * here, from the typed score, with the shared `getDifficulty` — so it is
 * recomputed on every edit (the doc is always rebuilt through this).
 */
export function buildManualMatchFields(m: ValidMatch, event: EventRef) {
  const alliance = (a: ManualAlliance): AllianceDoc => ({ teams: [...a.teams], score: a.score, penaltyPoints: a.penaltyPoints, difficulty: getDifficulty(a.score) });
  return {
    seasonId: event.seasonId,
    eventCode: event.eventCode,
    eventName: event.eventName,
    matchType: m.matchType,
    matchNumber: m.matchNumber,
    alliances: { red: alliance(m.red), blue: alliance(m.blue) },
    video: m.video,
    notes: m.notes,
  };
}

/** What a write needs to know about the doc it replaces (null when creating). */
export type ExistingManualDoc = { published?: unknown; needsReview?: unknown; createdBy?: unknown; importedAt?: unknown };

/**
 * The complete `libraryMatches` doc for a manual match: its content fields
 * (difficulty recomputed from the typed scores), plus origin, publishing state,
 * and bookkeeping. A match that already exists keeps its published / needsReview
 * state, its creator, and its first-import time; a new one gets the caller's
 * `newPublished` / `newNeedsReview`. This is exactly what lib/library/store.ts
 * writes, and what firestore.rules' validManualMatch() accepts.
 */
export function buildManualMatchDoc(
  match: ValidMatch,
  event: EventRef,
  current: ExistingManualDoc | null,
  options: { newPublished: boolean; newNeedsReview: boolean },
  actorUid: string,
  nowIso: string
) {
  return {
    ...buildManualMatchFields(match, event),
    origin: "manual" as const,
    published: current ? (typeof current.published === "boolean" ? current.published : true) : options.newPublished,
    needsReview: current ? current.needsReview === true : options.newNeedsReview,
    createdBy: typeof current?.createdBy === "string" ? current.createdBy : actorUid,
    importedAt: typeof current?.importedAt === "string" ? current.importedAt : nowIso,
    scoresUpdatedAt: nowIso,
    updatedAt: nowIso,
  };
}

// --- sanity warnings (never blocking) ----------------------------------------------------

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Is `score` far from `others` (this event's other manual alliance scores)?
 * Needs at least 4 others to say anything. Uses Tukey fences with a floor on
 * the margin, so a tight cluster of low scores doesn't flag every ordinary
 * match. Returns the typical range when it is an outlier, otherwise null.
 */
export function scoreOutlier(score: number, others: number[]): { low: number; high: number } | null {
  if (others.length < 4) return null;
  const sorted = [...others].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const margin = Math.max(1.5 * (q3 - q1), 40);
  if (score < q1 - margin || score > q3 + margin) return { low: Math.round(q1), high: Math.round(q3) };
  return null;
}

/**
 * Non-blocking warnings for a valid match: it replaces an existing match with
 * the same id, an alliance score is far from the event's other matches, or the
 * clip is very long. (The "same team twice in one match" case is a hard error
 * in validateRawMatch — all four teams must be distinct.)
 */
export function matchWarnings(match: ValidMatch, ctx: { event: Pick<EventRef, "eventCode">; existingIds: ReadonlySet<string>; siblings: ValidMatch[] }): string[] {
  const warnings: string[] = [];
  const id = manualMatchId(ctx.event, match);
  const label = matchLabel(match);
  if (ctx.existingIds.has(id)) warnings.push(`${label} already exists in this event — saving will replace it.`);

  const others = ctx.siblings.filter((s) => manualMatchId(ctx.event, s) !== id).flatMap((s) => [s.red.score, s.blue.score]);
  for (const [name, score] of [["Red", match.red.score], ["Blue", match.blue.score]] as const) {
    const outlier = scoreOutlier(score, others);
    if (outlier) warnings.push(`${name} score ${score} is far from this event's other matches (typically ${outlier.low}-${outlier.high}).`);
  }

  // A clip with an end time can be measured; one without ends with the video, whose length isn't known here.
  if (match.video && typeof match.video.endSec === "number") {
    const length = match.video.endSec - (match.video.startSec ?? 0);
    if (length > LONG_CLIP_SECONDS) warnings.push(`The video clip is ${formatTime(length)} long — a single match is usually under 3 minutes.`);
  }
  return warnings;
}
