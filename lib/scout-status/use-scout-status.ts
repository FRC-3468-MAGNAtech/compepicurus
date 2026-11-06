"use client";

import { useMemo } from "react";
import { useAnalyticsData, useAnalyticsEntries } from "@/lib/analytics/data-context";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { resolveEventCodes } from "@/lib/analytics/filters";
import { libraryMatchToOfficial, type OfficialMatch } from "@/lib/analytics/match-breakdown";
import { useEventMatches } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import { useTeamEventAttendance } from "@/lib/event-attendance";
import { getRole } from "@/lib/roles";
import { useTeamMembers } from "@/lib/team-members";
import type { StatusCategory } from "@/lib/scout-status/categories";
import {
  EMPTY_SETUP,
  buildCoverage,
  buildEventContext,
  buildScoutRows,
  individualTargets,
  maxTargets,
  playedFractionOf,
  sumTargets,
  summarizeAssignments,
  targetScouts,
  totalsRow,
  type CategoryRecord,
  type EventContext,
  type EventSetup,
  type MatchCoverage,
  type MaxTarget,
  type ScoutRow,
  type TargetCell,
} from "@/lib/scout-status/compute";
import { useTeamAssignmentSlots } from "@/lib/scout-status/use-assignments";
import { useScoutTargets } from "@/lib/scout-status/store";

export type EventSetupView = {
  eventCode: string;
  eventName: string;
  setup: EventSetup;
  ctx: EventContext;
  maxes: CategoryRecord<MaxTarget>;
  /** Per scout (the table's rows), this event only. */
  targets: Map<string, CategoryRecord<TargetCell>>;
  /** How many matches are in each category's range (the "N matches selected" chip). */
  availableCounts: Record<StatusCategory, number>;
  hasAssignments: boolean;
};

/**
 * Everything the Scout Status page shows, from the shared Analytics layer (entries already
 * filtered by Game / Event / Practice / Accuracy) plus the schedule, Assignments, attendance
 * and the saved setup. All numbers are computed in lib/scout-status/compute.ts.
 */
export function useScoutStatus(enabled: ReadonlySet<StatusCategory>) {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  const { entries, scope, loaded: entriesLoaded } = useAnalyticsEntries();
  const practice = filters.practice;

  const { members } = useTeamMembers(teamId);
  const { attendance } = useTeamEventAttendance(teamId);
  const { slotsByEvent } = useTeamAssignmentSlots(teamId);
  const targetsState = useScoutTargets(teamId);

  // The events in play: the filter's events, or (All events) every event with data.
  const eventCodes = useMemo(() => {
    const codes = resolveEventCodes(filters, data.activeEventCodes);
    return codes ?? [...new Set(scope.map((e) => e.eventCode))];
  }, [filters, data.activeEventCodes, scope]);

  const requests = useMemo(() => (practice ? [] : eventCodes.map((code) => ({ code, season: data.eventDirectory.get(code)?.season ?? data.season }))), [practice, eventCodes, data.eventDirectory, data.season]);
  const { matches: apiMatches, loading: matchesLoading } = useEventMatches(requests);

  // Official matches by event: the FIRST API schedule, or (Practice) the library's matches.
  const matchesByEvent = useMemo(() => {
    const map = new Map<string, OfficialMatch[]>();
    for (const code of eventCodes) map.set(code, []);
    const source: OfficialMatch[] = practice ? data.libraryMatches.filter((m) => m.seasonId === filters.gameId).map(libraryMatchToOfficial) : apiMatches;
    for (const m of source) map.get(m.eventCode)?.push(m);
    return map;
  }, [eventCodes, practice, data.libraryMatches, apiMatches, filters.gameId]);

  const eventName = (code: string) => data.eventDirectory.get(code)?.name ?? data.libraryMatches.find((m) => m.eventCode === code)?.eventName ?? code;

  // Per event: classified matches, maxes, and the counts — before any scout-specific targets.
  const baseViews = useMemo(
    () =>
      eventCodes.map((code) => {
        const setup = targetsState.setups.get(code) ?? EMPTY_SETUP;
        const ctx = buildEventContext({ eventCode: code, matches: matchesByEvent.get(code) ?? [], setup, enabled });
        const availableCounts = { practice: 0, qualification: 0, semi: 0, final: 0 } as Record<StatusCategory, number>;
        for (const m of ctx.matches) availableCounts[m.category] += 1;
        return { eventCode: code, setup, ctx, maxes: maxTargets(ctx, setup, enabled), availableCounts, assigned: summarizeAssignments(ctx, slotsByEvent.get(code)) };
      }),
    [eventCodes, targetsState.setups, matchesByEvent, enabled, slotsByEvent]
  );

  // The targets table's rows: attending Match Scouts (across the events in play) plus anyone added by hand.
  const scouts = useMemo(() => {
    const attendingUids = new Set<string>();
    for (const a of attendance) if (eventCodes.includes(a.eventCode)) for (const uid of a.uids) attendingUids.add(uid);
    const extraUids = new Set<string>();
    for (const v of baseViews) for (const uid of v.setup.extraScouts) extraUids.add(uid);
    return targetScouts({ members, attendingUids, extraUids, roleLabel: (r) => getRole(r as never).label });
  }, [members, attendance, eventCodes, baseViews]);

  const views = useMemo<EventSetupView[]>(
    () =>
      baseViews.map((v) => {
        const targets = new Map<string, CategoryRecord<TargetCell>>();
        for (const s of scouts) targets.set(s.uid, individualTargets(s.uid, v.setup, v.assigned, v.maxes, enabled));
        return { eventCode: v.eventCode, eventName: eventName(v.eventCode), setup: v.setup, ctx: v.ctx, maxes: v.maxes, targets, availableCounts: v.availableCounts, hasAssignments: v.assigned.hasSchedule };
      }),
    // eventName only reads the event directory and library list, which the memo inputs already track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseViews, scouts, enabled, data.eventDirectory, data.libraryMatches]
  );

  const result = useMemo(() => {
    const events = views.map((v) => v.ctx);
    const assignedSlots = new Map<string, Set<string>>();
    for (const v of baseViews) for (const [uid, set] of v.assigned.slots) assignedSlots.set(uid, new Set([...(assignedSlots.get(uid) ?? []), ...set]));
    const hasAssignments = baseViews.some((v) => v.assigned.hasSchedule);
    const targets = sumTargets(views.map((v) => v.targets));

    const rows: ScoutRow[] = buildScoutRows({
      scouts,
      entries,
      events,
      targets,
      assignedSlots,
      hasAssignments,
      playedFraction: practice ? 1 : playedFractionOf(events),
      nameFor: (uid, fallback) => members.find((m) => m.uid === uid)?.name ?? fallback,
    });
    const coverage: MatchCoverage[] = buildCoverage({ events, entries, practiceDataset: practice });
    return { rows, totals: totalsRow(rows), coverage, hasAssignments };
  }, [views, baseViews, scouts, members, entries, practice]);

  return {
    teamId,
    practice,
    members,
    views,
    eventCodes,
    scouts,
    ...result,
    setupsError: targetsState.error,
    retrySetups: targetsState.retry,
    loaded: entriesLoaded && targetsState.loaded && !(matchesLoading && !practice && matchesByEvent.size > 0 && [...matchesByEvent.values()].every((m) => m.length === 0)),
    entriesInScope: scope.length,
    entriesUsed: entries.length,
    /** The entries after every filter — what the table and coverage count from. */
    entriesFiltered: entries,
  };
}
