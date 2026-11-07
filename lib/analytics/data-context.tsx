"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useActiveEvents } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { orderPrimaryFirst, pickDefaultActiveEvent } from "@/lib/active-events";
import { isInScope, selectAnalyticsEntries, type AnalyticsEntry, type EntrySelection, type SelectOptions } from "@/lib/analytics/entries";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { resolveSingleEventCode, type AnalyticsFilters } from "@/lib/analytics/filters";
import { buildAllTeamStats, type TeamStats } from "@/lib/analytics/team-stats";
import { useTeamNames } from "@/lib/analytics/use-event-data";
import { getEvents } from "@/lib/ftc/actions";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import type { FtcEvent } from "@/lib/ftc/types";
import { useAllLibraryMatches, type LibraryMatch } from "@/lib/match-library";
import { useAllTeamPracticeSessions, type PracticeSession } from "@/lib/practice-sessions";
import { getSeason } from "@/lib/seasons";
import { useTeamScoutEntries, type ScoutEntry } from "@/lib/scout-entries";
import type { Form } from "@/lib/forms/types";
import { useGameFormIds, useSchemaForEntries } from "@/lib/forms/forms-context";

// The one realtime data layer every Analytics subpage reads (P10). It is
// mounted once in the Analytics layout, so there is exactly one team-wide
// scoutEntries subscription (and one practice-sessions subscription, only
// while Practice is on) no matter how many subpages the user visits — pages
// read from here via the hooks at the bottom instead of subscribing
// themselves.

export type EventOption = {
  code: string;
  name: string;
  /** The FIRST API event, when we know it (an active event, or one in the season's event list) — drives the status chip. */
  event: FtcEvent | null;
  active: boolean;
  /** Entries for this event under the current Game and Practice settings. */
  count: number;
};

type AnalyticsDataValue = {
  loaded: boolean;
  allEntries: ScoutEntry[];
  /** Practice sessions by id (only loaded while Practice is on). Full sessions, so Match Scout Analytics can toggle their exclusion. */
  sessionsById: Map<string, PracticeSession>;
  /** P21: the form the Game's entries were scouted with (every version of every form in scope, unioned), what the tables and stats are derived from. */
  schema: Form;
  /** The game's FIRST API season year, the fallback when an event's own season isn't known. */
  season: number;
  activeEventCodes: string[];
  /** Active events, primary first. */
  activeEvents: FtcEvent[];
  primaryCode: string | null;
  eventDirectory: ReadonlyMap<string, FtcEvent>;
  /** Every imported library match — Practice mode's official matches (Match Breakdown). */
  libraryMatches: LibraryMatch[];
  eventOptions: EventOption[];
  /** The standard selection (accuracy filter applied, excluded dropped) for the current URL filters — computed once and shared. */
  selection: EntrySelection;
  teamStats: TeamStats[];
  teamNames: ReadonlyMap<number, string>;
};

const DataContext = createContext<AnalyticsDataValue | null>(null);

export function AnalyticsDataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { filters } = useAnalyticsFilters();
  const { events: activeEventsRaw, primaryCode } = useActiveEvents();

  const { entries: allEntries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const { sessions, loaded: sessionsLoaded } = useAllTeamPracticeSessions(filters.practice ? teamId : null);
  const { matches: libraryMatches } = useAllLibraryMatches();

  const game = getSeason(filters.gameId);
  const gameFormIds = useGameFormIds(filters.gameId);

  const activeEvents = useMemo(() => orderPrimaryFirst({ events: activeEventsRaw, primaryCode }), [activeEventsRaw, primaryCode]);
  const activeEventCodes = useMemo(() => activeEvents.map((e) => e.code), [activeEvents]);

  // Active events carry their own season; everything else is looked up in the
  // game's season list (shared, cached, with Event Selection's own query).
  const seasonEvents = useFtcQuery(`events:${game.apiSeason}`, () => getEvents({ season: game.apiSeason }));
  const eventDirectory = useMemo(() => {
    const map = new Map<string, FtcEvent>();
    for (const e of seasonEvents.data ?? []) map.set(e.code, e);
    for (const e of activeEvents) map.set(e.code, e);
    return map;
  }, [seasonEvents.data, activeEvents]);

  const sessionsById = useMemo(() => new Map<string, PracticeSession>(sessions.map((s) => [s.id, s])), [sessions]);

  const selection = useMemo(
    () => selectAnalyticsEntries({ entries: allEntries, sessionsById, filters, activeEventCodes, gameFormIds }),
    [allEntries, sessionsById, filters, activeEventCodes, gameFormIds]
  );
  const { schema } = useSchemaForEntries(selection.scope, filters.gameId);

  const eventOptions = useMemo(() => {
    const options = new Map<string, EventOption>();
    const add = (code: string, name: string, active: boolean) => {
      if (!options.has(code)) options.set(code, { code, name, event: eventDirectory.get(code) ?? null, active, count: 0 });
    };

    if (filters.practice) {
      for (const m of libraryMatches) add(m.eventCode, m.eventName, false);
    } else {
      for (const e of activeEvents) add(e.code, e.name, true);
    }
    // Events with data under the current Game/Practice settings, whatever the Event filter says.
    const scopeAnyEvent = allEntries.filter((e) => isInScope(e, { ...filters, events: { kind: "all" } }, null, gameFormIds));
    for (const e of scopeAnyEvent) {
      add(e.eventCode, eventDirectory.get(e.eventCode)?.name ?? e.eventCode, activeEventCodes.includes(e.eventCode) && !filters.practice);
      options.get(e.eventCode)!.count += 1;
    }

    return [...options.values()].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.active && b.active ? activeEventCodes.indexOf(a.code) - activeEventCodes.indexOf(b.code) : 0) ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
    );
  }, [allEntries, filters, libraryMatches, activeEvents, activeEventCodes, eventDirectory, gameFormIds]);

  // Names for every event that has data in scope (not just the ones passing the accuracy filter), so they don't flicker as the threshold changes.
  const nameRequests = useMemo(() => {
    const codes = [...new Set(selection.scope.map((e) => e.eventCode))];
    return codes.map((code) => ({ code, season: eventDirectory.get(code)?.season ?? game.apiSeason }));
  }, [selection.scope, eventDirectory, game.apiSeason]);
  const teamNames = useTeamNames(nameRequests);

  const teamStats = useMemo(() => buildAllTeamStats(selection.used, schema, teamNames), [selection.used, schema, teamNames]);

  const value = useMemo<AnalyticsDataValue>(
    () => ({
      loaded: entriesLoaded && (!filters.practice || sessionsLoaded),
      allEntries,
      sessionsById,
      schema,
      season: game.apiSeason,
      activeEventCodes,
      activeEvents,
      primaryCode,
      eventDirectory,
      libraryMatches,
      eventOptions,
      selection,
      teamStats,
      teamNames,
    }),
    [entriesLoaded, sessionsLoaded, filters.practice, allEntries, sessionsById, schema, game.apiSeason, activeEventCodes, activeEvents, primaryCode, eventDirectory, libraryMatches, eventOptions, selection, teamStats, teamNames]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** Everything the provider holds. Prefer the narrower hooks below; the filter bar and Match Scout Analytics need the extras. */
export function useAnalyticsData(): AnalyticsDataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useAnalyticsData must be used inside <AnalyticsDataProvider> (the Analytics layout mounts it).");
  return ctx;
}

export type AnalyticsEntriesResult = {
  /** What a page may use: Game/Event/Practice scoped, excluded dropped, accuracy threshold applied (unless `options` say otherwise). */
  entries: AnalyticsEntry[];
  /** Everything matching Game/Event/Practice — "M" in "N of M entries shown". */
  scope: AnalyticsEntry[];
  usedCount: number;
  scopeCount: number;
  loaded: boolean;
  filters: AnalyticsFilters;
  schema: Form;
};

/**
 * The filtered entries for the current Analytics filters, each joined to its
 * alliance-match accuracy. With no arguments this is the shared, already
 * computed selection. Pass `filters` to evaluate a different filter state
 * (e.g. a page that pins one event), or `options` for the raw view (Match
 * Scout Analytics: `{ applyAccuracy: false, includeExcluded: true }`).
 */
export function useAnalyticsEntries(filtersOverride?: AnalyticsFilters, options?: SelectOptions): AnalyticsEntriesResult {
  const data = useAnalyticsData();
  const { filters: urlFilters } = useAnalyticsFilters();
  const filters = filtersOverride ?? urlFilters;
  const gameFormIds = useGameFormIds(filters.gameId);
  const applyAccuracy = options?.applyAccuracy ?? true;
  const includeExcluded = options?.includeExcluded ?? false;
  const isStandard = filtersOverride === undefined && applyAccuracy && !includeExcluded;

  const custom = useMemo(
    () =>
      isStandard
        ? null
        : selectAnalyticsEntries(
            { entries: data.allEntries, sessionsById: data.sessionsById, filters, activeEventCodes: data.activeEventCodes, gameFormIds },
            { applyAccuracy, includeExcluded }
          ),
    [isStandard, data.allEntries, data.sessionsById, filters, data.activeEventCodes, applyAccuracy, includeExcluded, gameFormIds]
  );
  const selection = custom ?? data.selection;

  return {
    entries: selection.used,
    scope: selection.scope,
    usedCount: selection.used.length,
    scopeCount: selection.scope.length,
    loaded: data.loaded,
    filters,
    schema: data.schema,
  };
}

/**
 * The one event a single-event page shows: the viewer's explicit pick, else an
 * In Progress active event (the primary if it is one), else the primary, else
 * the first event with data. `event` is the FIRST API event when known (its
 * season is needed for FIRST API calls like recompute).
 */
export function useSingleEvent(): { code: string | null; event: FtcEvent | null } {
  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  const [now] = useState(() => Date.now());
  const fallback = pickDefaultActiveEvent({ events: data.activeEvents, primaryCode: data.primaryCode }, now)?.code ?? data.eventOptions[0]?.code ?? null;
  const code = resolveSingleEventCode(filters, fallback);
  return { code, event: code ? (data.eventDirectory.get(code) ?? null) : null };
}

/** Per-team stats for the standard selection — memoized once in the provider and shared by Team Averages, Rankings, and Team Profile. */
export function useTeamStats(): { teamStats: TeamStats[]; teamNames: ReadonlyMap<number, string>; loaded: boolean; schema: Form; entries: AnalyticsEntry[] } {
  const data = useAnalyticsData();
  return { teamStats: data.teamStats, teamNames: data.teamNames, loaded: data.loaded, schema: data.schema, entries: data.selection.used };
}
