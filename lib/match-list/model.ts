import { formatMatch, matchSortValue } from "@/lib/analytics/game-schema";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { parseEventTime } from "@/lib/dashboard/time";
import { classifyMatch, finalsMatchNumbers, statusMatchLabel, type StatusCategory } from "@/lib/scout-status/categories";

// FIX4: the Match List page's pure logic: one event's schedule as rows (label, time, teams, status, who is "ours"),
// the next upcoming match, the Practice / Qualifications / Playoffs tabs, and the page's two filters. No React.

/** A match that hasn't been played, whose scheduled start was at most this long ago, is "In Progress" (a match cycle is about this long). */
export const IN_PROGRESS_WINDOW_MS = 15 * 60 * 1000;

export type MatchListStatus = "upcoming" | "in-progress" | "completed";

/** The page's three tabs. Playoffs holds the Semi-Finals and Finals (their rows are labelled `SF5`, `F14`). */
export type MatchListTab = "practice" | "qualification" | "playoff";

export const MATCH_LIST_TABS: { id: MatchListTab; label: string }[] = [
  { id: "practice", label: "Practice" },
  { id: "qualification", label: "Qualifications" },
  { id: "playoff", label: "Playoffs" },
];

export const tabOf = (category: StatusCategory): MatchListTab => (category === "practice" ? "practice" : category === "qualification" ? "qualification" : "playoff");

export type MatchListRow = {
  /** Unique across events: `CODE|Type|Number`. */
  key: string;
  eventCode: string;
  matchType: OfficialMatch["matchType"];
  matchNumber: number;
  category: StatusCategory;
  tab: MatchListTab;
  /** "P12", "Q12", "SF5", "F14" (the Scout Status classifier's labels). */
  label: string;
  /** The label Match Breakdown's `?match=` understands ("F5" for any playoff match). */
  linkLabel: string;
  /** The scheduled start as an instant; null when the API gave none. */
  startMs: number | null;
  red: number[];
  blue: number[];
  redScore: number | null;
  blueScore: number | null;
  played: boolean;
  status: MatchListStatus;
  /** One of the account's FTC teams plays in it. */
  ours: boolean;
  /** The next upcoming match of its event and tab (at most one per event and tab). */
  isNext: boolean;
};

/**
 * One event's matches as rows, in play order (Practice, Qualification, Playoff; by number).
 *
 * Status: a played match is Completed. Of the unplayed matches in a tab, the first one whose scheduled start has
 * passed (by no more than `IN_PROGRESS_WINDOW_MS`) is In Progress, because the schedule says it should be on the
 * field; every other unplayed match is Upcoming (including ones the schedule has slipped past: they are still
 * ahead of us). The first Upcoming match of each tab is `isNext`.
 */
export function buildMatchRows(input: { eventCode: string; matches: OfficialMatch[]; timeZone: string | null; now: number; isOurTeam: (n: number) => boolean; finalsOverride?: ReadonlySet<number> | null }): MatchListRow[] {
  const mine = input.matches.filter((m) => m.eventCode === input.eventCode);
  const classifiable = mine.map((m) => ({ matchType: m.matchType, matchNumber: m.matchNumber, series: m.series }));
  const finals = finalsMatchNumbers(classifiable, input.finalsOverride);

  const rows: MatchListRow[] = [...mine]
    .sort((a, b) => matchSortValue(a) - matchSortValue(b))
    .map((m) => {
      const category = classifyMatch({ matchType: m.matchType, matchNumber: m.matchNumber, series: m.series }, classifiable, input.finalsOverride, finals);
      const scored = m.played && m.red.score !== null && m.blue.score !== null;
      return {
        key: `${m.eventCode}|${m.matchType}|${m.matchNumber}`,
        eventCode: m.eventCode,
        matchType: m.matchType,
        matchNumber: m.matchNumber,
        category,
        tab: tabOf(category),
        label: statusMatchLabel(category, m.matchNumber),
        linkLabel: formatMatch(m),
        startMs: parseEventTime(m.startTime, input.timeZone),
        red: m.red.teams,
        blue: m.blue.teams,
        redScore: scored ? m.red.score : null,
        blueScore: scored ? m.blue.score : null,
        played: m.played,
        status: m.played ? "completed" : "upcoming",
        ours: [...m.red.teams, ...m.blue.teams].some((t) => input.isOurTeam(t)),
        isNext: false,
      } satisfies MatchListRow;
    });

  for (const tab of MATCH_LIST_TABS) {
    const unplayed = rows.filter((r) => r.tab === tab.id && !r.played);
    const first = unplayed[0];
    let nextTaken = false;
    if (first && first.startMs !== null && first.startMs <= input.now && input.now - first.startMs <= IN_PROGRESS_WINDOW_MS) {
      first.status = "in-progress";
      nextTaken = true; // the one on the field isn't "next"; the one after it is
      const after = unplayed[1];
      if (after) after.isNext = true;
    }
    if (!nextTaken && first) first.isNext = true;
  }
  return rows;
}

/** Rows of one tab. */
export const rowsInTab = (rows: MatchListRow[], tab: MatchListTab): MatchListRow[] => rows.filter((r) => r.tab === tab);

/** How many rows each tab holds (for the tab badges). */
export function tabCounts(rows: MatchListRow[]): Record<MatchListTab, number> {
  const counts: Record<MatchListTab, number> = { practice: 0, qualification: 0, playoff: 0 };
  for (const r of rows) counts[r.tab] += 1;
  return counts;
}

/**
 * The tab to open on: the one holding the event's next (or in-progress) match; failing that the last one with
 * anything in it that has a result (the event is over, show the latest phase); else the first non-empty tab.
 */
export function defaultTab(rows: MatchListRow[]): MatchListTab {
  const live = rows.find((r) => r.status === "in-progress") ?? rows.find((r) => r.status === "upcoming");
  if (live) return live.tab;
  for (const tab of [...MATCH_LIST_TABS].reverse()) if (rows.some((r) => r.tab === tab.id)) return tab.id;
  return "qualification";
}

export type MatchListFilters = { ourOnly: boolean; search: string };

/** "All matches / Our matches" plus the team-number search (a digit prefix or substring of any team in the match). */
export function filterRows(rows: MatchListRow[], filters: MatchListFilters): MatchListRow[] {
  const q = filters.search.trim().replace(/^#/, "");
  return rows.filter((r) => {
    if (filters.ourOnly && !r.ours) return false;
    if (q === "") return true;
    return [...r.red, ...r.blue].some((t) => String(t).includes(q));
  });
}

/** The winner for a played match with scores. */
export function winnerOf(row: Pick<MatchListRow, "redScore" | "blueScore">): "red" | "blue" | "tie" | null {
  if (row.redScore === null || row.blueScore === null) return null;
  return row.redScore > row.blueScore ? "red" : row.redScore < row.blueScore ? "blue" : "tie";
}

/** "Sat 9:30 AM" in the event's own time zone (the viewer's when the event has none); "Time TBD" without a start. */
export function formatStart(startMs: number | null, timeZone: string | null, locale?: string): string {
  if (startMs === null) return "Time TBD";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(locale, timeZone ? { ...opts, timeZone } : opts).format(new Date(startMs));
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(startMs));
  }
}
