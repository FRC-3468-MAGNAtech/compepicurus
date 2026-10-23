"use client";

import { ScoutForm, type ScoutFormValues } from "@/components/scout/scout-form";
import { useActiveEvent } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { saveEntry, type ScoreBreakdown } from "@/lib/scout-entries";
import { valuesToScoutEntryFields } from "@/lib/scout-form/schema";
import { recomputeForEvent } from "@/lib/analytics/recompute";

export default function MatchScoutFormPage() {
  const { activeEvent } = useActiveEvent();
  const { user, profile } = useAuth();
  const name = profile?.name ?? "";

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

      <ScoutForm mode="event" activeEvent={activeEvent} prefill={{ scoutName: name }} onSubmit={handleSubmit} />
    </div>
  );
}
