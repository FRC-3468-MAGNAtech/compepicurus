"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoutForm, type ScoutFormValues } from "@/components/scout/scout-form";
import type { AssignedMatch } from "@/components/scout/match-picker-dialog";
import { useActiveEvent } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { useAssignments } from "@/lib/assignments";
import { useTeamScoutEntries, saveEntry, type ScoreBreakdown } from "@/lib/scout-entries";
import { valuesToScoutEntryFields } from "@/lib/scout-form/schema";
import { recomputeForEvent } from "@/lib/analytics/recompute";
import { matchSortValue } from "@/lib/analytics/game-schema";
import type { FtcMatch } from "@/lib/ftc/types";

/** A synthetic FtcMatch for an assigned slot — same convention as match-picker-dialog's manual-entry mode: no roster/score data exists for it yet, and downstream code already treats an unmatched (eventCode, type, number) as "no official data" gracefully. */
function syntheticAssignedMatch(matchType: FtcMatch["type"], matchNumber: number): AssignedMatch {
  return {
    type: matchType,
    match: {
      id: `${matchType}-assignment-${matchNumber}`,
      matchNumber,
      type: matchType,
      description: null,
      series: null,
      played: false,
      redTeams: [],
      blueTeams: [],
      redScore: null,
      blueScore: null,
      redPenaltyPoints: null,
      bluePenaltyPoints: null,
      startTime: null,
    },
  };
}

export default function MatchScoutFormPage() {
  const { activeEvent } = useActiveEvent();
  const { user, profile } = useAuth();
  const name = profile?.name ?? "";
  const teamId = profile?.teamId ?? null;

  const { assignments } = useAssignments(teamId, activeEvent?.code ?? null);
  const { entries } = useTeamScoutEntries(teamId);
  const [loadedAssignment, setLoadedAssignment] = useState<{ match: AssignedMatch; teamNumber: number } | null>(null);

  const nextAssignment = (() => {
    if (!assignments?.current || !user || !activeEvent) return null;
    const mySlots = assignments.current.slots.filter((s) => s.scoutUid === user.uid);
    const sorted = [...mySlots].sort((a, b) => matchSortValue(a) - matchSortValue(b));
    return (
      sorted.find(
        (s) =>
          !entries.some(
            (e) =>
              e.uid === user.uid &&
              e.source === "event" &&
              e.eventCode === activeEvent.code &&
              e.matchType === s.matchType &&
              e.matchNumber === s.matchNumber &&
              e.teamNumber === s.teamNumber
          )
      ) ?? null
    );
  })();

  const handleLoadAssignment = () => {
    if (!nextAssignment) return;
    setLoadedAssignment({
      match: syntheticAssignedMatch(nextAssignment.matchType, nextAssignment.matchNumber),
      teamNumber: nextAssignment.teamNumber,
    });
  };

  const handleSubmit = async (values: ScoutFormValues, score: ScoreBreakdown) => {
    if (!profile || !user || !activeEvent || !values.match || values.teamNumber === null) return;

    await saveEntry(profile.teamId, user.uid, {
      scoutName: name,
      eventCode: activeEvent.code,
      matchType: values.match.type,
      matchNumber: values.match.match.matchNumber,
      teamNumber: values.teamNumber,
      fields: valuesToScoutEntryFields(values.fields),
      score,
      comments: String(values.fields.comments ?? ""),
    });
    // Recomputes the whole event's accuracy/flags (not just this entry) so a
    // different robot's entry can flip from "Needs Robots" to resolved once
    // its alliance partner is scouted too. Fire-and-forget: it never throws
    // (every call inside is already error-handled) and shouldn't block reset.
    void recomputeForEvent(profile.teamId, activeEvent.code, activeEvent.season);
    // The just-saved entry's realtime update will advance `nextAssignment` —
    // clear the loaded override so the form reflects whatever that becomes.
    setLoadedAssignment(null);
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Match Scout Form</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Log what you see, live, match by match.</p>
        </div>
        {/* Reserved for a future form/season picker (a dropdown letting scouts
            choose forms for different seasons, or custom forms from a form
            builder) — intentionally empty for now. */}
        <div data-slot="form-season-picker" />
      </div>

      {nextAssignment && !loadedAssignment && (
        <GlassPanel className="flex flex-wrap items-center gap-3">
          <Badge variant="glass" className="gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" /> Next assignment
          </Badge>
          <span className="text-sm">
            {nextAssignment.matchType} {nextAssignment.matchNumber} &middot; Team {nextAssignment.teamNumber}
          </span>
          <Button size="sm" variant="glass" className="ml-auto" onClick={handleLoadAssignment}>
            Load this assignment
          </Button>
        </GlassPanel>
      )}

      <ScoutForm
        mode="event"
        activeEvent={activeEvent}
        prefill={{ scoutName: name, ...loadedAssignment }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
