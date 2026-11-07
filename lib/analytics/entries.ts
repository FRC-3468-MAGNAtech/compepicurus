import type { ScoutEntry } from "@/lib/scout-entries";
import type { PracticeSession } from "@/lib/practice-sessions";
import { resolveEventCodes, type AnalyticsFilters } from "@/lib/analytics/filters";

// Pure selection logic for the shared Analytics dataset (P10). The realtime
// subscriptions live in data-context.tsx; this module only turns "every entry
// the team has" + a filter state into the entries each page may use.

/** The slice of a practice session an entry needs joined onto it. */
export type SessionAccuracy = Pick<PracticeSession, "accuracy" | "excluded" | "scoutedTotal" | "penaltyPoints" | "officialScore">;

/**
 * A scout entry joined to its **alliance-match accuracy** — the number the
 * accuracy filter and every stat's "avg accuracy" use.
 *
 * Accuracy is never recomputed here: real-event entries carry the value the
 * shared engine already stored on them (`lib/analytics/recompute.ts`), and
 * practice/live entries take their session's accuracy (practice scoring is per
 * session, both robots — see docs/ASSUMPTIONS.md, P9). For practice entries
 * `accuracy` is also replaced by the session's, exactly as Match Scout
 * Analytics has always displayed it.
 */
export type AnalyticsEntry = ScoutEntry & {
  /** Whole-alliance accuracy as a 0-100 percent, or `null` when it can't be computed (e.g. the other robot wasn't scouted). */
  allianceAccuracy: number | null;
  /** Excluded from stats — the entry itself (real events) or its session (practice). Always ignored by stats. */
  isExcluded: boolean;
};

export function toAnalyticsEntry(entry: ScoutEntry, session?: SessionAccuracy | null): AnalyticsEntry {
  if (entry.source === "event") {
    const acc = entry.accuracy;
    const allianceAccuracy = acc && acc.status === "complete" && acc.value !== null ? acc.value * 100 : null;
    return { ...entry, allianceAccuracy, isExcluded: entry.excluded };
  }

  if (!session || session.accuracy === null) {
    return { ...entry, accuracy: null, allianceAccuracy: null, isExcluded: entry.excluded || !!session?.excluded };
  }
  return {
    ...entry,
    accuracy: {
      status: "complete",
      value: session.accuracy / 100,
      scoutedTotal: session.scoutedTotal,
      penaltyPoints: session.penaltyPoints,
      officialScore: session.officialScore,
    },
    allianceAccuracy: session.accuracy,
    isExcluded: entry.excluded || session.excluded,
  };
}

/**
 * Compared on the whole percent the UI displays (the same rounding
 * `getStatus` uses), so an alliance shown as "75%" passes a 75% threshold
 * instead of being dropped for being 74.6.
 */
export function passesAccuracy(entry: Pick<AnalyticsEntry, "allianceAccuracy">, threshold: number | null): boolean {
  if (threshold === null) return true;
  return entry.allianceAccuracy !== null && Math.round(entry.allianceAccuracy) >= threshold;
}

/** Game, event, and Practice (mode/source) — everything except accuracy and exclusion. */
export function isInScope(entry: ScoutEntry, filters: AnalyticsFilters, eventCodes: string[] | null, gameFormIds?: ReadonlySet<string>): boolean {
  // P21: a Game (season) can be scouted with more than one form (the built-in, an edited copy, a custom form made active), so scope by the season's set of form ids when given.
  if (gameFormIds ? !gameFormIds.has(entry.formId) && entry.formId !== filters.gameId : entry.formId !== filters.gameId) return false;
  if (eventCodes !== null && !eventCodes.includes(entry.eventCode)) return false;

  if (!filters.practice) return entry.source === "event";

  // Practice data: practice + live entries, never real-event ones. Same
  // semantics as P9's Match Analytics toggle — a specific Mode (Trial /
  // Competitive) only matches `practice` entries, since live entries have no mode.
  if (entry.source === "event") return false;
  if (filters.practiceMode !== "all" && entry.mode !== filters.practiceMode) return false;
  if (filters.practiceSource !== "all" && entry.source !== filters.practiceSource) return false;
  return true;
}

export type SelectOptions = {
  /** Apply the accuracy threshold. Off for the raw Match Scout Analytics table. Default true. */
  applyAccuracy?: boolean;
  /** Keep excluded entries. Only the raw Match Scout Analytics table wants them (it shows and toggles exclusion). Default false. */
  includeExcluded?: boolean;
};

export type EntrySelection = {
  /** Everything matching Game / Event / Practice — the "M" in "N of M entries shown". */
  scope: AnalyticsEntry[];
  /** What a page may actually use: `scope` minus excluded entries, minus those under the accuracy threshold. The "N". */
  used: AnalyticsEntry[];
};

export function selectAnalyticsEntries(
  input: {
    entries: ScoutEntry[];
    sessionsById: Map<string, SessionAccuracy>;
    filters: AnalyticsFilters;
    /** The team's active event codes — only consulted for the `active` event scope. */
    activeEventCodes: string[];
    /** P21: every form id that counts as the filter's Game (default: just the Game's own id). */
    gameFormIds?: ReadonlySet<string>;
  },
  options: SelectOptions = {}
): EntrySelection {
  const { applyAccuracy = true, includeExcluded = false } = options;
  const eventCodes = resolveEventCodes(input.filters, input.activeEventCodes);

  const scope: AnalyticsEntry[] = [];
  for (const entry of input.entries) {
    if (!isInScope(entry, input.filters, eventCodes, input.gameFormIds)) continue;
    const session = entry.sessionId ? input.sessionsById.get(entry.sessionId) : null;
    scope.push(toAnalyticsEntry(entry, session));
  }

  const used = scope.filter((e) => (includeExcluded || !e.isExcluded) && (!applyAccuracy || passesAccuracy(e, input.filters.accuracy)));
  return { scope, used };
}
