import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { formMatchKey, type NewFormEntry } from "@/lib/form-entries-model";
import { defaultValues, normalizeValues, validateValues } from "@/lib/forms/values";
import { parseSlotKey, slotCountFor, valueSlots, maxRepeatSlots } from "@/lib/forms/repeat";
import { isSystemField, type Form, type FormValues, type StickyNote } from "@/lib/forms/types";
import { notesForSave } from "@/lib/sticky-notes";
import type { FormEntryType } from "@/lib/form-entries-model";

// P28: the pure parts of the match-based form pages (Lead Scout, Match Strategy, Drive Reflection): which teams an alliance has, what must be filled in, and the
// document that is saved. The page (components/forms/form-page.tsx) only wires these to the pickers and the database.

export type EntryAnswers = { eventCode: string; matchKey: string | null; alliance: "red" | "blue" | null; teamNumber: number | null; scoutName: string };

/** The team numbers of one alliance in one match of the schedule (empty when the match isn't in it, or isn't chosen yet). */
export function allianceTeamsFor(matches: readonly OfficialMatch[], eventCode: string, matchKey: string | null, alliance: "red" | "blue" | null): number[] {
  if (!matchKey || !alliance) return [];
  const m = matches.find((x) => x.eventCode === eventCode && formMatchKey(x.matchType, x.matchNumber) === matchKey);
  return m ? [...m[alliance].teams] : [];
}

/** "RED / 1111, 2222": the alliance box's title. */
export function allianceTitle(alliance: "red" | "blue" | null, teams: readonly number[]): string {
  if (!alliance) return "Alliance";
  return `${alliance.toUpperCase()}${teams.length > 0 ? ` / ${teams.join(", ")}` : ""}`;
}

/** The form's slot values reset to their defaults (what changing the match or the alliance does: the old teams' answers don't belong to the new ones); everything else is kept. */
export function resetSlotValues(form: Pick<Form, "sections">, values: FormValues): FormValues {
  const defaults = defaultValues(form);
  const next: FormValues = { ...values };
  for (const s of valueSlots(form)) if (s.slot !== null) next[s.storageKey] = defaults[s.storageKey];
  return next;
}

/** The slots beyond the alliance's size are not saved (a 2-team alliance doesn't store `t3_*`). */
export function trimSlots(values: FormValues, slotCount: number): FormValues {
  const out: FormValues = {};
  for (const [k, v] of Object.entries(values)) {
    const slot = parseSlotKey(k);
    if (!slot || slot.slot <= slotCount) out[k] = v;
  }
  return out;
}

const has = (form: Pick<Form, "sections">, type: string) => form.sections.some((s) => s.fields.some((f) => f.type === type && isSystemField(f)));

/** Everything that must be filled in before a form can be submitted: the pickers the form has, then every visible required answer for the slots shown. Empty = fine. */
export function validateSubmission(form: Form, answers: EntryAnswers, values: FormValues, slotCount: number | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  if (has(form, "eventPicker") && !answers.eventCode) errors.eventCode = "Choose an event.";
  if (has(form, "matchPicker") && !answers.matchKey) errors.match = "Choose a match.";
  if (has(form, "alliancePicker") && !answers.alliance) errors.alliance = "Choose Red or Blue.";
  if (has(form, "teamPicker") && answers.teamNumber === null) errors.teamNumber = "Choose a team.";
  return { ...errors, ...validateValues(form, values, { slotCount }) };
}

/** The document a submit saves (before the server times): the pickers' answers, the values cleaned and trimmed to the slots shown, the notes without blanks, and the plan link. */
export function buildSubmission(form: Form, answers: EntryAnswers, values: FormValues, notes: readonly StickyNote[], teamsInAlliance: number, plan: { differences: number; linkedEntryId: string | null } | null): NewFormEntry {
  const max = maxRepeatSlots(form);
  const slotCount = max > 0 ? slotCountFor(teamsInAlliance || 2, max) : 0;
  const cleaned = normalizeValues(form, values);
  return {
    scoutName: answers.scoutName,
    formId: form.id,
    formVersion: form.version,
    formType: form.formType as FormEntryType,
    eventCode: answers.eventCode,
    ...(has(form, "matchPicker") ? { matchKey: answers.matchKey } : {}),
    ...(has(form, "alliancePicker") ? { alliance: answers.alliance } : {}),
    ...(has(form, "teamPicker") ? { teamNumber: answers.teamNumber } : {}),
    values: max > 0 ? trimSlots(cleaned, slotCount) : cleaned,
    stickyNotes: notesForSave(notes),
    ...(form.compareWith && plan ? { linkedEntryId: plan.linkedEntryId, planDifferences: plan.differences } : {}),
  };
}
