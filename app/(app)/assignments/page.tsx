"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, Shuffle, Undo2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MemberMultiSelect } from "@/components/assignments/member-multiselect";
import { RandomizeModal } from "@/components/assignments/randomize-modal";
import { ScheduleGrid } from "@/components/assignments/schedule-grid";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import { useActiveEvent } from "@/lib/active-event";
import { useTeamMembers } from "@/lib/team-members";
import { useEventAttendance, setEventAttendance } from "@/lib/event-attendance";
import { publishAssignments, swapAssignmentSlot, undoAssignments, useAssignments, type AssignmentMatchSource, type AssignmentSettings, type AssignmentVersion } from "@/lib/assignments";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getEvents, getMatchesForEvent } from "@/lib/ftc/actions";
import { getDefaultSeason } from "@/lib/ftc/config";
import { useLibraryMatchesBySeason } from "@/lib/match-library";
import { getEnabledSeasons, DEFAULT_SEASON_ID } from "@/lib/seasons";
import { DIFFICULTY_LABELS, type Difficulty } from "@/lib/difficulty";
import { ftcMatchesToInputs, libraryMatchesToInputs } from "@/lib/scheduler/sources";
import type { MatchInput, ScheduleResult, SlotId } from "@/lib/scheduler/types";

const MATCH_SOURCE_LABELS: Record<AssignmentMatchSource, string> = {
  event: "Event schedule",
  practice: "Practice library",
  live: "Live",
};

export default function AssignmentsPage() {
  const { user, profile } = useAuth();
  const { isAdmin } = usePermissions();
  const teamId = profile?.teamId ?? null;
  const { activeEvent } = useActiveEvent();

  const [eventOverride, setEventOverride] = useState<string | null>(null);
  const eventCode = eventOverride ?? activeEvent?.code ?? null;
  const season = activeEvent?.season ?? getDefaultSeason();

  const eventsQuery = useFtcQuery(`assignments-events:${season}`, () => getEvents({ season }));

  const { members, loaded: membersLoaded } = useTeamMembers(teamId);
  const { attendance, loaded: attendanceLoaded } = useEventAttendance(teamId, eventCode);
  const { assignments, loaded: assignmentsLoaded } = useAssignments(teamId, eventCode);

  const [attendingUids, setAttendingUids] = useState<string[] | null>(null);
  const attendanceUids = attendance?.uids;
  const effectiveAttendingUids = useMemo(() => attendingUids ?? attendanceUids ?? [], [attendingUids, attendanceUids]);
  const [savingAttendance, setSavingAttendance] = useState(false);

  const [matchSource, setMatchSource] = useState<AssignmentMatchSource>("event");
  const [librarySeasonId, setLibrarySeasonId] = useState(DEFAULT_SEASON_ID);
  const [libraryDifficulty, setLibraryDifficulty] = useState<Difficulty>("medium");

  const qualQuery = useFtcQuery(
    matchSource !== "practice" && eventCode ? `assign:${eventCode}:Q:${season}` : null,
    () => getMatchesForEvent(eventCode!, "Qualification", season)
  );
  const playoffQuery = useFtcQuery(
    matchSource !== "practice" && eventCode ? `assign:${eventCode}:F:${season}` : null,
    () => getMatchesForEvent(eventCode!, "Playoff", season)
  );
  const practiceTypeQuery = useFtcQuery(
    matchSource !== "practice" && eventCode ? `assign:${eventCode}:P:${season}` : null,
    () => getMatchesForEvent(eventCode!, "Practice", season)
  );
  const { matches: libraryMatches } = useLibraryMatchesBySeason(matchSource === "practice" ? librarySeasonId : null);

  const candidateMatches: MatchInput[] = useMemo(() => {
    if (matchSource === "practice") return libraryMatchesToInputs(libraryMatches, libraryDifficulty);
    const ftc = [...(qualQuery.data ?? []), ...(playoffQuery.data ?? []), ...(practiceTypeQuery.data ?? [])];
    return ftcMatchesToInputs(ftc);
  }, [matchSource, libraryMatches, libraryDifficulty, qualQuery.data, playoffQuery.data, practiceTypeQuery.data]);

  const attendingMembers = useMemo(() => members.filter((m) => effectiveAttendingUids.includes(m.uid)), [members, effectiveAttendingUids]);

  const [randomizeOpen, setRandomizeOpen] = useState(false);
  const [draft, setDraft] = useState<{ settings: AssignmentSettings; result: ScheduleResult } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const handleSaveAttendance = async () => {
    if (!teamId || !eventCode) return;
    setSavingAttendance(true);
    try {
      await setEventAttendance(teamId, eventCode, effectiveAttendingUids);
      setAttendingUids(null);
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleGenerated = (settings: AssignmentSettings, result: ScheduleResult) => {
    setDraft({ settings, result });
  };

  const handlePublish = async () => {
    if (!teamId || !eventCode || !draft || !user) return;
    setPublishing(true);
    try {
      const version: AssignmentVersion = {
        generatedBy: user.uid,
        generatedAt: new Date().toISOString(),
        settings: draft.settings,
        slots: draft.result.slots,
        counts: draft.result.counts,
        fair: draft.result.fair,
        warning: draft.result.warning,
      };
      await publishAssignments(teamId, eventCode, version);
      setDraft(null);
    } finally {
      setPublishing(false);
    }
  };

  const handleUndo = async () => {
    if (!teamId || !eventCode) return;
    setUndoing(true);
    try {
      await undoAssignments(teamId, eventCode);
    } finally {
      setUndoing(false);
    }
  };

  const handleSwap = (matchType: string, matchNumber: number, slot: SlotId, newScoutUid: string | null) => {
    if (!teamId || !eventCode) return;
    void swapAssignmentSlot(teamId, eventCode, matchType as never, matchNumber, slot, newScoutUid);
  };

  const myAssignments = !assignments?.current || !user ? [] : assignments.current.slots.filter((s) => s.scoutUid === user.uid);

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Who&apos;s scouting which robot, for {eventCode ?? "the active event"}.</p>
        </div>
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Your assignments</h2>
          {myAssignments.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No assignments yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {myAssignments.map((s, i) => (
                <div key={i} className="glass-card flex items-center gap-3 p-3 text-sm">
                  <Badge variant="glass" className="font-mono">
                    {s.matchType} {s.matchNumber}
                  </Badge>
                  <span>Team {s.teamNumber}</span>
                  <span className="text-[var(--muted-foreground)]">{s.slot}</span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Attendance and the scouting schedule for one event.</p>
        </div>
        <div className="w-full sm:w-64">
          <Label htmlFor="assignments-event">Event</Label>
          <Select value={eventCode ?? ""} onValueChange={setEventOverride}>
            <SelectTrigger id="assignments-event">
              <SelectValue>
                {eventsQuery.data?.find((e) => e.code === eventCode)?.name ?? eventCode ?? "Pick an event"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(eventsQuery.data ?? []).map((e) => (
                <SelectItem key={e.code} value={e.code}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!eventCode ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          <CalendarCheck className="mx-auto mb-2 h-6 w-6" />
          Pick an event to manage its attendance and schedule.
        </GlassPanel>
      ) : (
        <>
          <GlassPanel className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Attendance</h2>
              <Button size="sm" disabled={savingAttendance || !membersLoaded} onClick={handleSaveAttendance}>
                {savingAttendance ? "Saving…" : "Save attendance"}
              </Button>
            </div>
            {!membersLoaded || !attendanceLoaded ? (
              <div className="glass-card h-24 animate-pulse" />
            ) : (
              <MemberMultiSelect members={members} selected={effectiveAttendingUids} onChange={setAttendingUids} />
            )}
          </GlassPanel>

          <GlassPanel className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Schedule</h2>
              <Button className="gap-2" onClick={() => setRandomizeOpen(true)} disabled={attendingMembers.length === 0}>
                <Shuffle className="h-4 w-4" /> Randomize
              </Button>
            </div>

            <Tabs value={matchSource} onValueChange={(v) => setMatchSource(v as AssignmentMatchSource)}>
              <TabsList>
                {(Object.keys(MATCH_SOURCE_LABELS) as AssignmentMatchSource[]).map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {MATCH_SOURCE_LABELS[s]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {matchSource === "practice" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="library-season">Season</Label>
                  <Select value={librarySeasonId} onValueChange={setLibrarySeasonId}>
                    <SelectTrigger id="library-season">
                      <SelectValue>{getEnabledSeasons().find((s) => s.id === librarySeasonId)?.name}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {getEnabledSeasons().map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="library-difficulty">Difficulty</Label>
                  <Select value={libraryDifficulty} onValueChange={(v) => setLibraryDifficulty(v as Difficulty)}>
                    <SelectTrigger id="library-difficulty">
                      <SelectValue>{DIFFICULTY_LABELS[libraryDifficulty]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                        <SelectItem key={d} value={d}>
                          {DIFFICULTY_LABELS[d]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {draft ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Badge variant="warning">Unpublished draft</Badge>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                      Discard
                    </Button>
                    <Button size="sm" disabled={publishing} onClick={handlePublish}>
                      {publishing ? "Publishing…" : "Save / Publish"}
                    </Button>
                  </div>
                </div>
                <ScheduleGrid version={draft.result} members={members} />
              </div>
            ) : assignmentsLoaded && assignments?.current ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Published {new Date(assignments.current.generatedAt).toLocaleString()}
                  </span>
                  {assignments.previous && (
                    <Button variant="ghost" size="sm" className="gap-1.5" disabled={undoing} onClick={handleUndo}>
                      <Undo2 className="h-3.5 w-3.5" /> Undo to previous version
                    </Button>
                  )}
                </div>
                <ScheduleGrid version={assignments.current} members={members} onSwap={handleSwap} />
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No schedule published yet for this event.</p>
            )}
          </GlassPanel>
        </>
      )}

      <RandomizeModal
        open={randomizeOpen}
        onOpenChange={setRandomizeOpen}
        matchSource={matchSource}
        seasonId={matchSource === "practice" ? librarySeasonId : null}
        difficulty={matchSource === "practice" ? libraryDifficulty : null}
        matches={candidateMatches}
        attendingMembers={attendingMembers}
        onGenerated={handleGenerated}
      />
    </div>
  );
}
