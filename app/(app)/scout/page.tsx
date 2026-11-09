"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoutForm, type ScoutFormValues } from "@/components/scout/scout-form";
import { StickyNotesLayout } from "@/components/forms/sticky-notes-panel";
import { notesForSave } from "@/lib/sticky-notes";
import type { StickyNote } from "@/lib/forms/types";
import type { AssignedMatch } from "@/components/scout/match-picker-dialog";
import { useActiveEvents } from "@/lib/active-event";
import { orderPrimaryFirst, pickDefaultActiveEvent } from "@/lib/active-events";
import { useAuth } from "@/lib/auth";
import { useAssignments } from "@/lib/assignments";
import { useTeamScoutEntries, saveEntry, entryPayloadFor } from "@/lib/scout-entries";
import type { ScoreResult } from "@/lib/forms/scoring";
import { useActiveForm, useForms } from "@/lib/forms/forms-context";
import { recomputeForEvent } from "@/lib/analytics/recompute";
import { nextAssignment as findNextAssignment } from "@/lib/dashboard/insights";
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

// `useSearchParams` needs a Suspense boundary for the static build.
export default function MatchScoutFormPage() {
  return (
    <Suspense fallback={<div className="glass-card h-64 animate-pulse" />}>
      <MatchScoutFormContent />
    </Suspense>
  );
}

function MatchScoutFormContent() {
  const { events, primaryCode } = useActiveEvents();
  const { user, profile } = useAuth();
  // The Dashboard's "Scout now" opens this page as /scout?event=CODE&load=next — pre-picking that
  // event and loading the scout's next assignment (P13).
  const searchParams = useSearchParams();
  // Fixed per visit; only used to prefer an In Progress event as the default.
  const [now] = useState(() => Date.now());
  const [pickedEventCode, setPickedEventCode] = useState<string | null>(() => searchParams.get("event"));
  const [autoLoadNext, setAutoLoadNext] = useState(() => searchParams.get("load") === "next");
  const eventChoices = orderPrimaryFirst({ events, primaryCode });
  // The scout's own pick wins while that event is still active; otherwise an
  // In Progress active event, otherwise the primary. With one active event all
  // of this collapses to that event, exactly as before.
  const activeEvent = events.find((e) => e.code === pickedEventCode) ?? pickDefaultActiveEvent({ events, primaryCode }, now);
  const name = profile?.name ?? "";
  const teamId = profile?.teamId ?? null;
  // P21: scouts fill in the season's active form (the built-in unless an admin chose another or edited it).
  const { form, loaded: formsLoaded } = useActiveForm();
  const forms = useForms();

  const { assignments } = useAssignments(teamId, activeEvent?.code ?? null);
  const { entries } = useTeamScoutEntries(teamId);
  // P28: the sticky notes written while scouting this robot (saved with the entry; the old Comments column folds them in)
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [loadedAssignment, setLoadedAssignment] = useState<{ match: AssignedMatch; teamNumber: number } | null>(null);

  const nextAssignment = assignments?.current && user && activeEvent ? findNextAssignment(assignments.current.slots, user.uid, activeEvent.code, entries) : null;

  // An explicit load wins; otherwise a `?load=next` link loads the next assignment as soon as it's known.
  const effectiveLoaded =
    loadedAssignment ?? (autoLoadNext && nextAssignment ? { match: syntheticAssignedMatch(nextAssignment.matchType, nextAssignment.matchNumber), teamNumber: nextAssignment.teamNumber } : null);

  const handleLoadAssignment = () => {
    if (!nextAssignment) return;
    setLoadedAssignment({
      match: syntheticAssignedMatch(nextAssignment.matchType, nextAssignment.matchNumber),
      teamNumber: nextAssignment.teamNumber,
    });
  };

  const handleSubmit = async (values: ScoutFormValues, score: ScoreResult) => {
    if (!profile || !user || !activeEvent || !values.match || values.teamNumber === null) return;

    await saveEntry(profile.teamId, user.uid, {
      scoutName: name,
      eventCode: activeEvent.code,
      matchType: values.match.type,
      matchNumber: values.match.match.matchNumber,
      teamNumber: values.teamNumber,
      ...entryPayloadFor(form, values.values, score, { stickyNotes: notesForSave(notes) }),
    });
    setNotes([]);
    // Recomputes the whole event's accuracy/flags (not just this entry) so a
    // different robot's entry can flip from "Needs Robots" to resolved once
    // its alliance partner is scouted too. Fire-and-forget: it never throws
    // (every call inside is already error-handled) and shouldn't block reset.
    void recomputeForEvent(profile.teamId, activeEvent.code, activeEvent.season, forms.currentResolver);
    // The just-saved entry's realtime update will advance `nextAssignment` —
    // clear the loaded override so the form reflects whatever that becomes.
    setLoadedAssignment(null);
    setAutoLoadNext(false);
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Match Scout Form</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Log what you see, live, match by match.</p>
        </div>
        {formsLoaded && form.id !== "biobuzz" && (
          <span className="glass-pill px-3 py-1.5 text-xs font-medium" data-testid="active-form-name">
            {form.name}
          </span>
        )}
      </div>

      {nextAssignment && !effectiveLoaded && (
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

      {!formsLoaded ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : (
      <StickyNotesLayout enabled={!!form.stickyNotes?.enabled} defaultOpen={form.stickyNotes?.defaultOpen} notes={notes} onChange={setNotes}>
      <ScoutForm
        key={`${form.id}@${form.version}`}
        schema={form}
        mode="event"
        activeEvent={activeEvent}
        eventChoices={eventChoices}
        onEventChange={(event) => {
          setPickedEventCode(event.code);
          // An assignment loaded for the previous event doesn't apply to this one.
          setLoadedAssignment(null);
          setAutoLoadNext(false);
        }}
        prefill={{ scoutName: name, ...effectiveLoaded }}
        onSubmit={handleSubmit}
      />
      </StickyNotesLayout>
      )}
    </div>
  );
}
