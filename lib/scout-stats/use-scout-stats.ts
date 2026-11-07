"use client";

import { useMemo } from "react";
import { useTeamEventAttendance } from "@/lib/event-attendance";
import { useAllLibraryMatches } from "@/lib/match-library";
import { useTeamPracticeSessions } from "@/lib/practice-sessions";
import type { RoleId } from "@/lib/roles";
import { useTeamScoutEntries, type ScoutEntry } from "@/lib/scout-entries";
import { useTeamMembers } from "@/lib/team-members";
import { useFieldTeams } from "@/lib/field-teams-context";
import type { FtcEvent } from "@/lib/ftc/types";
import { computeScoutStats } from "./engine";
import type { RankingBasisId, RealEventCalculationScope, ScoutCategory, ScoutStatsResult } from "./types";

/** Every realtime source Scout Accuracy / My Scouting need, wired together — kept separate from the pure `computeScoutStats` so that function stays unit-testable with plain fixtures. */
export function useScoutStatsSources(teamId: string | null) {
  const { members, loaded: membersLoaded } = useTeamMembers(teamId);
  const { sessions, loaded: sessionsLoaded } = useTeamPracticeSessions(teamId);
  const { entries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const { matches, loaded: matchesLoaded } = useAllLibraryMatches();
  const { attendance, loaded: attendanceLoaded } = useTeamEventAttendance(teamId);

  const libraryMatchesById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const loaded = membersLoaded && sessionsLoaded && entriesLoaded && matchesLoaded && attendanceLoaded;

  return { members, sessions, entries, libraryMatchesById, attendance, loaded };
}

/**
 * Distinct real-event event codes the team has data for, most-recently-scouted first — what the Real Event Calculation dropdown's per-event options come from (see docs/ASSUMPTIONS.md, P5, for why this reads `scoutEntries` rather than the P6 Assignments page).
 *
 * FIX1: pass the team's active events (primary first) and they lead the list —
 * named, and present even before anything has been scouted for them — ahead
 * of the data-only events. With no active events this is unchanged.
 */
export function useRealEventOptions(entries: ScoutEntry[], activeEvents: FtcEvent[] = []): { eventCode: string; eventName: string }[] {
  return useMemo(() => {
    const latestByCode = new Map<string, string>();
    for (const e of entries) {
      if (e.source !== "event" && e.source !== "live") continue;
      const existing = latestByCode.get(e.eventCode);
      if (!existing || e.submittedAt > existing) latestByCode.set(e.eventCode, e.submittedAt);
    }
    const active = activeEvents.map((e) => ({ eventCode: e.code, eventName: e.name }));
    const activeCodes = new Set(active.map((e) => e.eventCode));
    const dataOnly = [...latestByCode.entries()]
      .filter(([eventCode]) => !activeCodes.has(eventCode))
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([eventCode]) => ({ eventCode, eventName: eventCode }));
    return [...active, ...dataOnly];
  }, [entries, activeEvents]);
}

export type UseScoutStatsOptions = {
  teamId: string | null;
  category: ScoutCategory;
  roleFilter: RoleId[];
  eventFilter: string[];
  /** P19: FTC team ids to show (empty = everyone). */
  teamFilter?: string[];
  rankingBasis: RankingBasisId;
  realEventScope: RealEventCalculationScope;
};

/** Combines `useScoutStatsSources` with `computeScoutStats`, memoized on every input that actually changes the result. */
export function useScoutStats({ teamId, category, roleFilter, eventFilter, teamFilter, rankingBasis, realEventScope }: UseScoutStatsOptions): {
  result: ScoutStatsResult | null;
  loaded: boolean;
  sources: ReturnType<typeof useScoutStatsSources>;
} {
  const sources = useScoutStatsSources(teamId);
  const { fieldTeams } = useFieldTeams();
  const { members, sessions, entries, libraryMatchesById, attendance, loaded } = sources;

  const result = useMemo(() => {
    if (!loaded) return null;
    return computeScoutStats({
      category,
      members,
      sessions,
      entries,
      libraryMatchesById,
      attendance,
      roleFilter,
      eventFilter,
      teamFilter,
      fieldTeams,
      rankingBasis,
      realEventScope,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loaded,
    category,
    members,
    sessions,
    entries,
    libraryMatchesById,
    attendance,
    roleFilter,
    eventFilter,
    teamFilter,
    fieldTeams,
    rankingBasis,
    realEventScope.eventCode,
    realEventScope.variant,
  ]);

  return { result, loaded, sources };
}
