"use client";

import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { FormPageView, type PickedMatch } from "@/components/forms/form-page";
import { PhotoUploadProvider } from "@/components/forms/photo-upload";
import { MatchPickerDialog } from "@/components/scout/match-picker-dialog";
import { FieldLabel } from "@/components/scout/field-inputs";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";
import { useActiveEvents } from "@/lib/active-event";
import { orderPrimaryFirst, pickDefaultActiveEvent } from "@/lib/active-events";
import { useEventMatches, useEventTeams } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import { formMatchKey } from "@/lib/form-entries-model";
import { saveFormEntry, useFormEntries } from "@/lib/form-entries";
import type { PlanCandidate } from "@/lib/forms/compare";
import { useForms } from "@/lib/forms/forms-context";
import { getBuiltinForm } from "@/lib/forms/builtin";
import type { FtcEvent } from "@/lib/ftc/types";

/** The match field of these forms: a button that opens the same match picker the Match Scout Form uses (Practice, Qualification, Finals with the bracket). */
function MatchPickerSlot({ label, event, matchKey, disabled, onPick }: { label: string; event: FtcEvent | null; matchKey: string | null; disabled?: boolean; onPick: (m: PickedMatch) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <FieldLabel label={label} required />
      <Button type="button" variant="glass" className="h-12 w-full justify-between rounded-2xl px-4" disabled={disabled || !event} onClick={() => setOpen(true)} data-testid="match-pick">
        <span className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" aria-hidden /> {matchKey ?? "Choose a match"}
        </span>
      </Button>
      <MatchPickerDialog open={open} onOpenChange={setOpen} activeEvent={event} onSelect={(a) => onPick({ matchKey: formMatchKey(a.type, a.match.matchNumber), matchType: a.type, match: a.match })} />
    </div>
  );
}

/** A match-based form page on live data: the account's active events, the FIRST schedule and teams, the plan entries, and `formEntries` for saving. */
export function FormPage({ formId, title, subtitle }: { formId: string; title: string; subtitle: string }) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const forms = useForms();
  const form = forms.latest(formId) ?? getBuiltinForm(formId);
  const { events, primaryCode, loaded } = useActiveEvents();
  const ordered = useMemo(() => orderPrimaryFirst({ events, primaryCode }), [events, primaryCode]);
  const [now] = useState(() => Date.now());
  const defaultEvent = pickDefaultActiveEvent({ events, primaryCode }, now);
  const [eventCode, setEventCode] = useState<string | null>(null);
  const activeCode = ordered.some((e) => e.code === eventCode) ? eventCode : (defaultEvent?.code ?? null);
  const active = ordered.find((e) => e.code === activeCode) ?? null;

  const requests = useMemo(() => (active ? [{ code: active.code, season: active.season }] : []), [active]);
  const { matches } = useEventMatches(requests);
  const { teams } = useEventTeams(requests);
  const teamOptions = useMemo(() => teams.map((t) => ({ teamNumber: t.teamNumber, name: t.nameShort })), [teams]);

  // the plan entries (Drive Reflection compares with Match Strategy): the chosen event's entries of the other form
  const { entries } = useFormEntries(form?.compareWith ? teamId : null, { formId: form?.compareWith?.formId, eventCode: active?.code });
  const planEntries = useMemo<PlanCandidate[]>(() => entries.map((e) => ({ id: e.id, formId: e.formId, eventCode: e.eventCode, matchKey: e.matchKey, alliance: e.alliance, createdAtMs: e.createdAtMs, values: e.values })), [entries]);

  if (!form || !loaded || !forms.loaded) return <Shimmer className="h-64" />;
  return (
    <PhotoUploadProvider>
      <FormPageView
        key={`${form.id}@${form.version}`}
        form={form}
        title={title}
        subtitle={subtitle}
        events={ordered}
        eventsLoaded={loaded}
        defaultEventCode={defaultEvent?.code ?? null}
        scoutName={profile?.name ?? ""}
        matches={matches}
        teams={teamOptions}
        planEntries={planEntries}
        onEventChange={setEventCode}
        renderMatchPicker={({ field, event, matchKey, disabled, onPick }) => <MatchPickerSlot label={field.label} event={event} matchKey={matchKey} disabled={disabled} onPick={onPick} />}
        onSave={(doc) => {
          if (!teamId || !user) return Promise.reject(new Error("Not signed in."));
          return saveFormEntry(teamId, user.uid, doc);
        }}
      />
    </PhotoUploadProvider>
  );
}
