import type { Difficulty } from "@/lib/difficulty";
import type { LibraryMatch } from "@/lib/match-library";
import type { AllianceColor, PracticeSession } from "@/lib/practice-sessions";
import type { MatchType } from "@/lib/ftc/types";

export type MatchRowStatus = "fresh" | "opened" | "scouted";

export type MatchRow = {
  libraryMatchId: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  alliance: AllianceColor;
  teams: number[];
  difficulty: Difficulty;
  hasVideo: boolean;
  status: MatchRowStatus;
  /** True when the most relevant session (the completed one, or an open one) belongs to the viewer. */
  byYou: boolean;
};

const STATUS_ORDER: Record<MatchRowStatus, number> = { fresh: 0, opened: 1, scouted: 2 };

/**
 * One row per (library match, alliance) that fits `difficulty` — both
 * alliances of a match can each produce their own row. Status is computed
 * team-wide from every `solo` session referencing that library
 * match+alliance (not just the viewer's own), per the spec: Scouted beats
 * Opened beats Fresh; `byYou` reflects whichever session decided the status.
 * Never includes the official score/penalty points — those stay hidden
 * until Results.
 */
export function buildMatchRows(
  matches: LibraryMatch[],
  sessions: PracticeSession[],
  uid: string,
  difficulty: Difficulty
): MatchRow[] {
  const rows: MatchRow[] = [];

  for (const match of matches) {
    for (const alliance of ["red", "blue"] as const) {
      const side = match.alliances[alliance];
      if (side.difficulty !== difficulty) continue;

      const relevant = sessions.filter((s) => s.libraryMatchId === match.id && s.alliance === alliance);
      const completed = relevant.filter((s) => s.status === "completed");
      const opened = relevant.filter((s) => s.status === "in-progress" || s.status === "paused");

      let status: MatchRowStatus = "fresh";
      let byYou = false;
      if (completed.length > 0) {
        status = "scouted";
        byYou = completed.some((s) => s.uid === uid);
      } else if (opened.length > 0) {
        status = "opened";
        byYou = opened.some((s) => s.uid === uid);
      }

      rows.push({
        libraryMatchId: match.id,
        eventCode: match.eventCode,
        matchType: match.matchType,
        matchNumber: match.matchNumber,
        alliance,
        teams: side.teams,
        difficulty: side.difficulty,
        hasVideo: match.video !== null,
        status,
        byYou,
      });
    }
  }

  return sortMatchRows(rows);
}

/** Fresh first, then Opened, then Scouted; within each group, by match number. */
export function sortMatchRows(rows: MatchRow[]): MatchRow[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.matchNumber - b.matchNumber);
}

/**
 * A random Fresh row, falling back to Opened then Scouted if none are
 * Fresh — the caller filters `rows` down to ones that are actually
 * startable (has video, or the team's placeholder-video setting is on)
 * before calling this, so it only ever picks something playable.
 */
export function pickRandomMatchRow(rows: MatchRow[]): MatchRow | null {
  for (const status of ["fresh", "opened", "scouted"] as const) {
    const pool = rows.filter((r) => r.status === status);
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}
