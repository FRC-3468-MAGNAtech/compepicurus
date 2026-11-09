"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Group, NumberRow, SelectRow, SwitchRow, TextRow } from "@/components/forms/builder/controls";
import { useBuilder } from "@/components/forms/builder/context";
import { setFormCompareWith, setFormStickyNotes, setFormType, setGroupRepeat } from "@/lib/forms/edit";
import { FORM_LIMITS } from "@/lib/forms/validate";
import { isSystemField, type CompareMatchOn, type FormGroup, type FormType } from "@/lib/forms/types";

// P27: the form-level settings for the team's other forms: what the form is for, the sticky notes panel, plan-versus-actual; and a group's "one box per
// team of the alliance" switch.

export const FORM_TYPE_LABEL: Record<FormType, string> = {
  "match-scout": "Match scouting (scored)",
  "lead-scout": "Lead scout",
  "pit-scout": "Pit scouting",
  "team-strategy": "Team strategy",
  "match-strategy": "Match strategy",
  "drive-reflection": "Drive reflection",
  helper: "Helper",
  custom: "Other",
};

export function FormTypeSettings() {
  const { form, update } = useBuilder();
  return (
    <Group title="What this form is for">
      <SelectRow
        label="Form type"
        value={form.formType}
        onChange={(t) => t && update((f) => setFormType(f, t), "form:type")}
        options={(Object.keys(FORM_TYPE_LABEL) as FormType[]).map((t) => ({ value: t, label: FORM_TYPE_LABEL[t] }))}
        hint="Sets which pickers the form must have (event, match, alliance, team, scout). Switching adds the ones it needs; it never removes any."
      />
    </Group>
  );
}

export function StickyNotesSettings() {
  const { form, update } = useBuilder();
  const cfg = form.stickyNotes ?? { enabled: false, defaultOpen: false };
  return (
    <Group title="Sticky notes" badge={cfg.enabled ? <Badge variant="glass">on</Badge> : undefined} defaultOpen={cfg.enabled}>
      <SwitchRow label="Show the sticky notes panel" hint="A side panel (a bottom sheet on phones) for free-form notes. They're saved with the entry and show in analytics and CSV as a Notes column." checked={cfg.enabled} onChange={(v) => update((f) => setFormStickyNotes(f, { enabled: v, defaultOpen: v && cfg.defaultOpen }), "form:notes")} />
      {cfg.enabled && <SwitchRow label="Start open" checked={cfg.defaultOpen} onChange={(v) => update((f) => setFormStickyNotes(f, { enabled: true, defaultOpen: v }), "form:notes")} />}
    </Group>
  );
}

const MATCH_PARTS: { id: CompareMatchOn; label: string }[] = [
  { id: "eventCode", label: "Same event" },
  { id: "matchKey", label: "Same match" },
  { id: "alliance", label: "Same alliance" },
];

export function CompareSettings() {
  const { form, update } = useBuilder();
  const compare = form.compareWith;
  const keys = [...new Set(form.sections.flatMap((s) => s.fields).filter((f) => !isSystemField(f)).map((f) => f.key))];
  const entries = Object.entries(compare?.fieldMap ?? {});
  const set = (next: NonNullable<typeof compare>) => update((f) => setFormCompareWith(f, next), "form:compare");
  return (
    <Group title="Plan versus actual" badge={compare ? <Badge variant="glass">on</Badge> : undefined} defaultOpen={!!compare}>
      <SwitchRow
        label="Compare with another form's entries"
        hint="For a reflection on a plan: when the event, match and alliance are chosen, the latest matching entry of the other form prefills this one, and every answer that differs gets a caution icon."
        checked={!!compare}
        onChange={(v) => update((f) => setFormCompareWith(f, v ? { formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: {} } : null), "form:compare")}
      />
      {compare && (
        <>
          <TextRow label="The plan form's id" mono value={compare.formId} maxLength={40} onChange={(v) => set({ ...compare, formId: v.trim() })} hint="For example match-strategy-v1." />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium">Find the plan by</legend>
            {MATCH_PARTS.map((p) => (
              <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-primary)]"
                  checked={compare.matchOn.includes(p.id)}
                  onChange={() => {
                    const on = compare.matchOn.includes(p.id) ? compare.matchOn.filter((x) => x !== p.id) : [...compare.matchOn, p.id];
                    if (on.length > 0) set({ ...compare, matchOn: on });
                  }}
                />
                {p.label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold">Fields to prefill and compare</h4>
            <p className="text-[11px] text-[var(--muted-foreground)]">A field in a per-team group maps for every team automatically.</p>
            {entries.map(([key, planKey], i) => (
              <div key={`${key}-${i}`} className="glass-card flex flex-col gap-1.5 p-2" data-testid={`compare-row-${i}`}>
                <SelectRow label="This form's field" value={key} onChange={(k) => k && set({ ...compare, fieldMap: Object.fromEntries(entries.map(([a, b]) => (a === key ? [k, b] : [a, b]))) })} options={keys.map((k) => ({ value: k, label: k }))} />
                <TextRow label="The plan form's field key" mono value={planKey} onChange={(v) => set({ ...compare, fieldMap: { ...compare.fieldMap, [key]: v.trim() } })} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start gap-1.5 text-red-300"
                  aria-label={`Stop comparing ${key}`}
                  onClick={() => {
                    const next = { ...compare.fieldMap };
                    delete next[key];
                    set({ ...compare, fieldMap: next });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            ))}
            <Button
              variant="glass"
              size="sm"
              className="self-start gap-1.5"
              disabled={entries.length >= FORM_LIMITS.compareFields || keys.every((k) => k in compare.fieldMap)}
              onClick={() => {
                const next = keys.find((k) => !(k in compare.fieldMap));
                if (next) set({ ...compare, fieldMap: { ...compare.fieldMap, [next]: next } });
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Map a field
            </Button>
          </div>
        </>
      )}
    </Group>
  );
}

/** One group's per-team switch: draw its fields once per team of the chosen alliance, up to a maximum. */
export function GroupRepeatControls({ sectionId, group }: { sectionId: string; group: FormGroup }) {
  const { update } = useBuilder();
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--glass-border)] p-2" data-testid={`group-repeat-${group.id}`}>
      <SwitchRow
        label={`One box per team: "${group.title}"`}
        hint="Draws this group once for each team of the chosen alliance (2 in qualifications, up to 3 in the playoffs). Needs an alliance picker."
        checked={!!group.repeat}
        onChange={(v) => update((f) => setGroupRepeat(f, sectionId, group.id, v ? { source: "allianceTeams", maxSlots: 3 } : null), `rep:${group.id}`)}
      />
      {group.repeat && (
        <NumberRow
          label="Most teams"
          value={group.repeat.maxSlots}
          min={1}
          max={FORM_LIMITS.repeatSlots}
          step={1}
          onChange={(v) => v !== undefined && update((f) => setGroupRepeat(f, sectionId, group.id, { source: "allianceTeams", maxSlots: Math.round(v) }), `rep:${group.id}:n`)}
          hint="The real number comes from the schedule."
        />
      )}
    </div>
  );
}
