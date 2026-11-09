"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarX2, CheckCircle2, Send } from "lucide-react";
import { FormRenderer, type FormEntryState } from "@/components/forms/form-renderer";
import { StickyNotesLayout } from "@/components/forms/sticky-notes-panel";
import type { PhotoTarget } from "@/components/forms/photo-upload";
import { usePhotoUploads } from "@/components/forms/photo-upload";
import type { TeamOption } from "@/components/forms/team-select";
import { Button } from "@/components/ui/button";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { PlanCandidate } from "@/lib/forms/compare";
import { allianceTeamsFor, allianceTitle, buildSubmission, resetSlotValues, validateSubmission } from "@/lib/forms/form-page-logic";
import { maxRepeatSlots, slotCountFor } from "@/lib/forms/repeat";
import type { NewFormEntry } from "@/lib/form-entries-model";
import { defaultValues } from "@/lib/forms/values";
import type { Form, FormField, FormValues, StickyNote } from "@/lib/forms/types";
import type { FtcEvent, FtcMatch, MatchType } from "@/lib/ftc/types";
import { springSnappy } from "@/lib/motion";

// P28: the page shell shared by Lead Scout, Match Strategy and Drive Reflection (and any other form of the team's built from the schema). Everything the page
// needs from the world is a prop (events, the schedule, teams, the plan entries, how to pick a match, how to save), so the same component runs on the real
// page and on the browser-test fixture. What is drawn comes from the form schema (FormRenderer); what is saved is built by lib/forms/form-page-logic.ts.

export type PickedMatch = { matchKey: string; matchType: MatchType; match: FtcMatch | null };

export type FormPageViewProps = {
  form: Form;
  title: string;
  subtitle: string;
  events: FtcEvent[];
  eventsLoaded: boolean;
  /** The event to start on (the primary, or the one in progress). */
  defaultEventCode: string | null;
  scoutName: string;
  /** The schedule of the chosen event (the alliance's teams come from it; the match picker's own pick wins when it has teams). */
  matches: OfficialMatch[];
  teams: TeamOption[];
  /** Entries of the form this one compares with (a Drive Reflection's Match Strategy entries) for the chosen event. */
  planEntries: PlanCandidate[];
  /** How a match is chosen: the page renders the real picker (practice, qualification, finals with the bracket) and calls `onPick`. */
  renderMatchPicker: (ctx: { field: FormField; eventCode: string; event: FtcEvent | null; matchKey: string | null; onPick: (m: PickedMatch) => void; disabled?: boolean }) => ReactNode;
  /** Saves the entry; resolves with its id. Rejecting leaves the form as it is and shows the error. */
  onSave: (entry: NewFormEntry) => Promise<string>;
  onEventChange?: (eventCode: string) => void;
};

/** The Lead Scout's alliance box says "RED / 1111, 2222"; the section whose id is `alliance` is the one. */
const ALLIANCE_SECTION = "alliance";

export function FormPageView(props: FormPageViewProps) {
  const { form, title, subtitle, events, eventsLoaded, defaultEventCode, scoutName, matches, teams, planEntries, renderMatchPicker, onSave, onEventChange } = props;
  const uploads = usePhotoUploads();

  const [entry, setEntry] = useState<FormEntryState>(() => ({ eventCode: defaultEventCode ?? "", matchKey: null, alliance: null, teamNumber: null, scoutName }));
  const [values, setValues] = useState<FormValues>(() => defaultValues(form));
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [pickedMatch, setPickedMatch] = useState<PickedMatch | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [plan, setPlan] = useState<{ differences: number; linkedEntryId: string | null } | null>(null);
  const [formKey, setFormKey] = useState(0); // remounting the renderer clears what it remembers (edited fields, the plan prefill)
  const pending = useRef<Record<string, string[]>>({});

  // an event the account no longer has active falls back to the first one
  const eventCode = events.some((e) => e.code === entry.eventCode) ? entry.eventCode : (events[0]?.code ?? "");
  const event = events.find((e) => e.code === eventCode) ?? null;

  // the alliance's teams: the match picker's own pick when it knows them, else the schedule
  const allianceTeams = useMemo(() => {
    if (!entry.alliance || !entry.matchKey) return [];
    const picked = pickedMatch && pickedMatch.matchKey === entry.matchKey && pickedMatch.match ? (entry.alliance === "red" ? pickedMatch.match.redTeams : pickedMatch.match.blueTeams) : [];
    return picked.length > 0 ? picked : allianceTeamsFor(matches, eventCode, entry.matchKey, entry.alliance);
  }, [entry.alliance, entry.matchKey, pickedMatch, matches, eventCode]);

  const maxSlots = maxRepeatSlots(form);
  const slotCount = maxSlots > 0 ? slotCountFor(allianceTeams.length || 2, maxSlots) : undefined;
  const photoTarget: PhotoTarget | null = eventCode ? { kind: "form", formId: form.id, eventCode, teamNumber: entry.teamNumber ?? "event" } : null;

  const planQuery = { eventCode, matchKey: entry.matchKey, alliance: entry.alliance };
  const planEntry = useMemo(() => {
    const c = form.compareWith;
    if (!c) return null;
    const matching = planEntries.filter((p) => p.formId === c.formId);
    if (c.matchOn.includes("eventCode") && !eventCode) return null;
    if (c.matchOn.includes("matchKey") && !planQuery.matchKey) return null;
    if (c.matchOn.includes("alliance") && !planQuery.alliance) return null;
    const fits = matching.filter((p) => (!c.matchOn.includes("eventCode") || p.eventCode === eventCode) && (!c.matchOn.includes("matchKey") || p.matchKey === planQuery.matchKey) && (!c.matchOn.includes("alliance") || p.alliance === planQuery.alliance));
    return fits.reduce<PlanCandidate | null>((best, p) => (best === null || (p.createdAtMs ?? 0) >= (best.createdAtMs ?? 0) ? p : best), null);
  }, [form.compareWith, planEntries, eventCode, planQuery.matchKey, planQuery.alliance]);

  const changeEntry = (patch: Partial<FormEntryState>) => {
    const next = { ...entry, eventCode, ...patch };
    const sameMatchAlliance = next.matchKey === entry.matchKey && next.alliance === entry.alliance && next.eventCode === eventCode;
    setEntry(next);
    setErrors((e) => {
      const cleared = { ...e };
      if (patch.eventCode !== undefined) delete cleared.eventCode;
      if (patch.alliance !== undefined) delete cleared.alliance;
      if (patch.teamNumber !== undefined) delete cleared.teamNumber;
      return cleared;
    });
    if (patch.eventCode !== undefined && patch.eventCode !== eventCode) {
      onEventChange?.(patch.eventCode);
      setPickedMatch(null);
      setEntry({ ...next, matchKey: null });
    }
    // another match or alliance means other teams: their answers don't carry over, and the renderer starts fresh for the new plan
    if (!sameMatchAlliance && maxSlots > 0) {
      setValues((v) => resetSlotValues(form, v));
      setFormKey((k) => k + 1);
    }
  };

  const reset = () => {
    setValues(defaultValues(form));
    setNotes([]);
    setEntry({ eventCode, matchKey: null, alliance: null, teamNumber: null, scoutName });
    setPickedMatch(null);
    setErrors({});
    setPlan(null);
    setFormKey((k) => k + 1);
  };

  const submit = async () => {
    const answers = { ...entry, eventCode, scoutName };
    const problems = validateSubmission(form, answers, values, slotCount);
    setErrors(problems);
    setSaveError(null);
    if (Object.keys(problems).length > 0) {
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setSaving(true);
    try {
      const doc = buildSubmission(form, answers, values, notes, allianceTeams.length || 2, plan);
      const id = await onSave(doc);
      // a photo that is still uploading is attached to the saved entry when it finishes: nobody waits on the network
      if (uploads) for (const [key, ids] of Object.entries(pending.current)) if (ids.length > 0) uploads.attachWhenDone(ids, `formEntries/${id}`, key);
      pending.current = {};
      setDone(true);
      setTimeout(() => setDone(false), 2200);
      reset();
    } catch {
      setSaveError("Couldn't save that. Check your connection and try again: nothing was lost.");
    } finally {
      setSaving(false);
    }
  };

  if (eventsLoaded && events.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Header title={title} subtitle={subtitle} />
        <p className="glass-card flex items-center gap-2 p-4 text-sm text-[var(--muted-foreground)]" data-testid="no-active-event">
          <CalendarX2 className="h-4 w-4 shrink-0" aria-hidden /> No active event. Ask an admin to pick the active events.
        </p>
      </div>
    );
  }

  const notesCfg = form.stickyNotes;
  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="form-page">
      <Header title={title} subtitle={subtitle} />
      <StickyNotesLayout enabled={!!notesCfg?.enabled} defaultOpen={notesCfg?.defaultOpen} notes={notes} onChange={setNotes} disabled={saving}>
        <FormRenderer
          key={formKey}
          form={form}
          values={values}
          onValuesChange={setValues}
          entry={{ ...entry, eventCode, scoutName }}
          onEntryChange={changeEntry}
          events={events}
          teams={teams}
          allianceTeams={allianceTeams}
          errors={errors}
          photoTarget={photoTarget}
          onPendingPhotos={(key, ids) => (pending.current = { ...pending.current, [key]: ids })}
          plan={planEntry}
          onPlanChange={setPlan}
          disabled={saving}
          sectionTitle={(s) => (s.id === ALLIANCE_SECTION && entry.alliance ? allianceTitle(entry.alliance, allianceTeams) : undefined)}
          tintedSections={new Set([ALLIANCE_SECTION])}
          renderMatchPicker={(field) => renderMatchPicker({ field, eventCode, event, matchKey: entry.matchKey, disabled: saving, onPick: (m) => { setPickedMatch(m); changeEntry({ matchKey: m.matchKey }); setErrors((e) => { const c = { ...e }; delete c.match; return c; }); } })}
        />
      </StickyNotesLayout>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void submit()} disabled={saving} className="gap-2" data-testid="submit-form">
          <Send className="h-4 w-4" aria-hidden /> {saving ? "Saving…" : "Submit"}
        </Button>
        {saveError && (
          <span role="alert" className="text-sm font-medium text-red-300" data-testid="save-error">
            {saveError}
          </span>
        )}
        {Object.keys(errors).length > 0 && !saveError && (
          <span className="text-sm text-red-300" data-testid="invalid-note">
            Some answers are missing (shown in red).
          </span>
        )}
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            role="status"
            data-testid="submit-success"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={springSnappy}
            className="glass-strong fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-2xl"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Saved &mdash; ready for the next one.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-[var(--muted-foreground)]">{subtitle}</p>
    </div>
  );
}
