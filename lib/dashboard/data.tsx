"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useActiveEvents } from "@/lib/active-event";
import { pickDefaultActiveEvent } from "@/lib/active-events";
import { selectAnalyticsEntries, type AnalyticsEntry } from "@/lib/analytics/entries";
import { DEFAULT_FILTERS } from "@/lib/analytics/filters";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { buildAllTeamStats, rankTeams, type RankedTeam, type TeamStats } from "@/lib/analytics/team-stats";
import { useEventMatches, useEventRankingsStatus, useEventTeams } from "@/lib/analytics/use-event-data";
import { useAssignments, type AssignmentsDoc } from "@/lib/assignments";
import { useAuth } from "@/lib/auth";
import { buildOurMatches, nextOurMatch, ourRecord, type OurMatch, type Record3 } from "@/lib/dashboard/schedule";
import { sourcesFor, type DashboardSource } from "@/lib/dashboard/roles";
import { useTeamEventAttendance, type EventAttendance } from "@/lib/event-attendance";
import { getEventStatus } from "@/lib/ftc/event-status";
import type { EventLifecycleStatus, FtcEvent, FtcRanking, FtcTeam } from "@/lib/ftc/types";
import { useAllLibraryMatches, type LibraryMatch } from "@/lib/match-library";
import { useFormEntries } from "@/lib/form-entries";
import type { FormEntry } from "@/lib/form-entries-model";
import type { TeamAssignmentsDoc } from "@/lib/team-assignments/model";
import { useTeamAssignmentDocs } from "@/lib/team-assignments/store";
import { usePickList, type PickListDoc } from "@/lib/pick-list/store";
import { useAllTeamPracticeSessions, type PracticeSession } from "@/lib/practice-sessions";
import type { RoleId } from "@/lib/roles";
import { useTeamScoutEntries, type ScoutEntry } from "@/lib/scout-entries";
import type { Form } from "@/lib/forms/types";
import { useGameFormIds, useSchemaForEntries } from "@/lib/forms/forms-context";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import type { ScoutCategory, ScoutStatsResult } from "@/lib/scout-stats/types";
import { useActiveFieldTeam } from "@/lib/field-teams-context";
import { useTeamMembers, type TeamMember } from "@/lib/team-members";

// The one data layer every dashboard widget reads (P13). The provider owns
// every subscription and every derived value; widgets only read from context.
// That is what keeps reads modest: each Firestore collection is subscribed to
// exactly once for the whole dashboard, and only the ones the role being
// viewed (plus the admin strip) actually uses — see lib/dashboard/roles.ts.
// FIRST API data goes through the tab-level caches in use-event-data.ts, so it
// is fetched once per event however many widgets show it.

export type DashboardData = {
  // identity
  uid: string | null;
  userName: string;
  teamId: string | null;
  isAdmin: boolean;
  /** The role whose widgets are showing (possibly an admin's preview). */
  role: RoleId;
  ourNumber: number | null;
  needs: ReadonlySet<DashboardSource>;

  // event context
  events: FtcEvent[];
  /** False until the team doc (which lists the active events) has loaded — so "no active event" never flashes. */
  eventsLoaded: boolean;
  event: FtcEvent | null;
  eventStatus: EventLifecycleStatus | null;
  setEventCode: (code: string) => void;
  timeZone: string | null;

  // FIRST API (official data) — one fetch per event
  first: { loading: boolean; error: boolean };
  officialMatches: OfficialMatch[];
  rankings: FtcRanking[];
  teams: FtcTeam[];
  teamNames: ReadonlyMap<number, string>;
  /** Our slice of the schedule: every match we're in, in play order. */
  ourMatches: OurMatch[];
  nextMatch: OurMatch | null;
  ourRanking: FtcRanking | null;
  record: Record3 | null;
  /** Teams at the event (for rank-relative figures). */
  fieldSize: number;

  // scouting data for the selected event
  entriesLoaded: boolean;
  allEntries: ScoutEntry[];
  /** Real-event entries for this event, including excluded ones (coverage and review queues look at these). */
  eventEntries: ScoutEntry[];
  /** The same, minus excluded entries — what stats are built from. */
  usedEntries: AnalyticsEntry[];
  schema: Form;
  teamStats: TeamStats[];
  /** `rankTeams` by average total; teams under the minimum sample are listed unranked. */
  ranked: RankedTeam[];
  ourStats: TeamStats | null;
  ourScoutedRank: number | null;

  // optional sources (empty + `loaded: true` when this role doesn't use them)
  members: TeamMember[];
  membersLoaded: boolean;
  sessions: PracticeSession[];
  sessionsLoaded: boolean;
  libraryById: ReadonlyMap<string, LibraryMatch>;
  attendance: EventAttendance[];
  /** Members attending the selected event. */
  attendingUids: string[];
  attendanceLoaded: boolean;
  assignments: AssignmentsDoc | null;
  assignmentsLoaded: boolean;
  pickList: PickListDoc | null;
  pickListLoaded: boolean;
  /** P29: the selected event's form entries (every non-match form) — only for roles that show form coverage. */
  formEntries: FormEntry[];
  formEntriesLoaded: boolean;
  /** P31: the team's Pit Scouting / Team Strategy assignment docs (every event) — only for roles that show "My assigned teams". */
  teamAssignments: TeamAssignmentsDoc[];
  teamAssignmentsLoaded: boolean;
  /** Scout Accuracy / My Scouting numbers per category (all events, plain) — only when the role needs members. */
  scoutStats: Record<ScoutCategory, ScoutStatsResult> | null;
};

/** Exported so tests can render widgets against a fixture without any Firebase. */
export const DashboardContext = createContext<DashboardData | null>(null);

const EMPTY_LIBRARY: ReadonlyMap<string, LibraryMatch> = new Map();

export function DashboardProvider({ role, children }: { role: RoleId; children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? null;
  const teamId = profile?.teamId ?? null;
  const isAdmin = profile?.isAdmin ?? false;
  const needs = useMemo(() => sourcesFor(role, isAdmin), [role, isAdmin]);

  // P19: "our team" is the FTC team this user is viewing as (header strip, next match, rank, record all follow it).
  const { activeFieldTeam } = useActiveFieldTeam();
  const ourNumber = activeFieldTeam?.number ?? null;

  // --- event context -----------------------------------------------------------------
  const { events, primaryCode, loaded: eventsLoaded } = useActiveEvents();
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  // Fixed per visit: "which event is In Progress" doesn't need re-deriving every render, and render stays pure.
  const [visitedAt] = useState(() => Date.now());
  // The user's pick while it's still an active event; otherwise an In Progress one, else the primary.
  const event = useMemo(
    () => events.find((e) => e.code === pickedCode) ?? pickDefaultActiveEvent({ events, primaryCode }, visitedAt),
    [events, primaryCode, pickedCode, visitedAt]
  );
  const eventCode = event?.code ?? null;
  const eventStatus = useMemo(() => (event ? getEventStatus(event, visitedAt) : null), [event, visitedAt]);
  const timeZone = event?.timezone ?? null;

  // --- FIRST API: fetched once, shared by every widget ----------------------------------
  const requests = useMemo(() => (event ? [{ code: event.code, season: event.season }] : []), [event]);
  const matchesQ = useEventMatches(requests);
  const rankingsQ = useEventRankingsStatus(requests);
  const teamsQ = useEventTeams(requests);
  const rankings = useMemo(() => (eventCode ? (rankingsQ.rankings.get(eventCode) ?? []) : []), [rankingsQ.rankings, eventCode]);
  const teamNames = useMemo(() => new Map(teamsQ.teams.map((t) => [t.teamNumber, t.nameShort])), [teamsQ.teams]);

  const ourMatches = useMemo(() => buildOurMatches(matchesQ.matches, ourNumber, timeZone), [matchesQ.matches, ourNumber, timeZone]);
  const nextMatch = useMemo(() => nextOurMatch(ourMatches), [ourMatches]);
  const ourRanking = useMemo(() => rankings.find((r) => r.teamNumber === ourNumber) ?? null, [rankings, ourNumber]);
  const record = useMemo(() => ourRecord(ourRanking, ourMatches), [ourRanking, ourMatches]);

  // --- scout entries: always (every role's header strip and most widgets read them) ------------
  const { entries: allEntries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const gameFormIds = useGameFormIds(DEFAULT_FILTERS.gameId);

  const eventEntries = useMemo(() => (eventCode ? allEntries.filter((e) => e.source === "event" && e.eventCode === eventCode) : []), [allEntries, eventCode]);
  const usedEntries = useMemo(
    () =>
      eventCode
        ? selectAnalyticsEntries({
            entries: allEntries,
            sessionsById: new Map(),
            filters: { ...DEFAULT_FILTERS, events: { kind: "custom", codes: [eventCode] } },
            activeEventCodes: [],
            gameFormIds,
          }).used
        : [],
    [allEntries, eventCode, gameFormIds]
  );
  const { schema } = useSchemaForEntries(usedEntries, DEFAULT_FILTERS.gameId);
  const teamStats = useMemo(() => buildAllTeamStats(usedEntries, schema, teamNames), [usedEntries, schema, teamNames]);
  const ranked = useMemo(() => rankTeams(teamStats, "avgTotal"), [teamStats]);
  const ourStats = useMemo(() => teamStats.find((t) => t.teamNumber === ourNumber) ?? null, [teamStats, ourNumber]);
  const ourScoutedRank = useMemo(() => ranked.find((r) => r.stats.teamNumber === ourNumber)?.rank ?? null, [ranked, ourNumber]);

  // --- optional sources: a hook can't be conditional, so each is gated by passing null ---------
  const { members, loaded: membersLoaded } = useTeamMembers(needs.has("members") ? teamId : null);
  const { sessions, loaded: sessionsLoaded } = useAllTeamPracticeSessions(needs.has("sessions") ? teamId : null);
  const { matches: libraryMatches, loaded: libraryLoaded } = useAllLibraryMatches(needs.has("library"));
  const { attendance, loaded: attendanceLoaded } = useTeamEventAttendance(needs.has("attendance") ? teamId : null);
  const { assignments, loaded: assignmentsLoaded } = useAssignments(needs.has("assignments") ? teamId : null, eventCode);
  const { list: pickList, loaded: pickListLoaded } = usePickList(needs.has("pickList") ? teamId : null, eventCode, null);
  const { docs: teamAssignments, loaded: teamAssignmentsLoaded } = useTeamAssignmentDocs(needs.has("teamAssignments") ? teamId : null);
  const { entries: formEntries, loaded: formEntriesLoaded } = useFormEntries(needs.has("formEntries") && eventCode ? teamId : null, { eventCode: eventCode ?? undefined });

  const libraryById = useMemo(() => (needs.has("library") ? new Map(libraryMatches.map((m) => [m.id, m])) : EMPTY_LIBRARY), [needs, libraryMatches]);
  const attendingUids = useMemo(() => attendance.find((a) => a.eventCode === eventCode)?.uids ?? [], [attendance, eventCode]);

  // My Scouting's numbers (same module, same defaults: all events, plain calculation, preserved ranks).
  const scoutStats = useMemo(() => {
    if (!needs.has("members") || !membersLoaded || !entriesLoaded || (needs.has("sessions") && !sessionsLoaded) || (needs.has("library") && !libraryLoaded)) return null;
    const solo = sessions.filter((s) => s.kind === "solo");
    const run = (category: ScoutCategory) =>
      computeScoutStats({
        category,
        members,
        sessions: solo,
        entries: allEntries,
        libraryMatchesById: libraryById as Map<string, LibraryMatch>,
        attendance: [],
        roleFilter: [],
        eventFilter: [],
        rankingBasis: "preserve",
        realEventScope: { eventCode: null, variant: "plain" },
      });
    return { trial: run("trial"), competitive: run("competitive"), "real-event": run("real-event") };
  }, [needs, membersLoaded, entriesLoaded, sessionsLoaded, libraryLoaded, members, sessions, allEntries, libraryById]);

  const value = useMemo<DashboardData>(
    () => ({
      uid,
      userName: profile?.name ?? "",
      teamId,
      isAdmin,
      role,
      ourNumber,
      needs,
      events,
      eventsLoaded,
      event,
      eventStatus,
      setEventCode: setPickedCode,
      timeZone,
      first: { loading: matchesQ.loading || rankingsQ.loading || teamsQ.loading, error: matchesQ.error || rankingsQ.error },
      officialMatches: matchesQ.matches,
      rankings,
      teams: teamsQ.teams,
      teamNames,
      ourMatches,
      nextMatch,
      ourRanking,
      record,
      fieldSize: Math.max(teamsQ.teams.length, rankings.length, teamStats.length),
      entriesLoaded,
      allEntries,
      eventEntries,
      usedEntries,
      schema,
      teamStats,
      ranked,
      ourStats,
      ourScoutedRank,
      members,
      membersLoaded,
      sessions,
      sessionsLoaded,
      libraryById,
      attendance,
      attendingUids,
      attendanceLoaded,
      assignments,
      assignmentsLoaded,
      pickList,
      pickListLoaded,
      formEntries,
      formEntriesLoaded,
      teamAssignments,
      teamAssignmentsLoaded,
      scoutStats,
    }),
    [
      uid, profile?.name, teamId, isAdmin, role, ourNumber, needs, events, eventsLoaded, event, eventStatus, timeZone,
      matchesQ, rankingsQ, teamsQ, rankings, teamNames, ourMatches, nextMatch, ourRanking, record, teamStats,
      entriesLoaded, allEntries, eventEntries, usedEntries, schema, ranked, ourStats, ourScoutedRank,
      members, membersLoaded, sessions, sessionsLoaded, libraryById, attendance, attendingUids, attendanceLoaded,
      assignments, assignmentsLoaded, pickList, pickListLoaded, formEntries, formEntriesLoaded, teamAssignments, teamAssignmentsLoaded, scoutStats,
    ]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

/** Everything the dashboard's widgets read. */
export function useDashboard(): DashboardData {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside <DashboardProvider> (the Dashboard page mounts it).");
  return ctx;
}

export type OurTeamEvent = Pick<
  DashboardData,
  "event" | "eventStatus" | "timeZone" | "first" | "officialMatches" | "rankings" | "teams" | "teamNames" | "ourNumber" | "ourMatches" | "nextMatch" | "ourRanking" | "record" | "fieldSize"
> & {
  /** Our most recent played match, if any. */
  lastMatch: OurMatch | null;
};

/**
 * Our team at the selected event: schedule, record, official rank, next match.
 * Reads the provider's already-fetched data — calling it from ten widgets costs
 * nothing extra.
 */
export function useOurTeamEvent(): OurTeamEvent {
  const d = useDashboard();
  const lastMatch = useMemo(() => [...d.ourMatches].reverse().find((m) => m.played && m.result !== null) ?? null, [d.ourMatches]);
  return {
    event: d.event,
    eventStatus: d.eventStatus,
    timeZone: d.timeZone,
    first: d.first,
    officialMatches: d.officialMatches,
    rankings: d.rankings,
    teams: d.teams,
    teamNames: d.teamNames,
    ourNumber: d.ourNumber,
    ourMatches: d.ourMatches,
    nextMatch: d.nextMatch,
    ourRanking: d.ourRanking,
    record: d.record,
    fieldSize: d.fieldSize,
    lastMatch,
  };
}
