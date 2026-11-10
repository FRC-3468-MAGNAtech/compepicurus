"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { CheckboxTile } from "@/components/scout/checkbox-tile";
import { FieldLabel, SelectField } from "@/components/scout/field-inputs";
import { RenderedField } from "@/components/scout/scout-form";
import { PlanDiffIcon } from "@/components/forms/plan-diff-icon";
import type { PhotoTarget } from "@/components/forms/photo-upload";
import { TeamSelect, type TeamOption } from "@/components/forms/team-select";
import { Input } from "@/components/ui/input";
import { diffAgainstPlan, expandFieldMap, plannedText, prefillFromPlan, type PlanCandidate, type PlanDifference } from "@/lib/forms/compare";
import { layoutOf } from "@/lib/forms/edit";
import { repeatGroupOf, slotCountFor, slotKey } from "@/lib/forms/repeat";
import { isSystemField, type Form, type FormField, type FormSection, type FormValue, type FormValues } from "@/lib/forms/types";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import type { FtcEvent } from "@/lib/ftc/types";
import { cn } from "@/lib/utils";

// P27: the generic, schema-driven renderer for the team's non-match forms (Lead Scout, Pit Scout, strategy, reflection, helper, custom). It draws the form's
// categories and fields, the system pickers (event, alliance, team, scout; the match picker is a slot the page fills), per-team boxes for repeating groups
// (one per team of the chosen alliance, each with a team picker so a wrong schedule can be corrected) and, when the form compares with a plan, prefills from it
// and marks every answer that differs. The page owns the state and the submit button; this only draws and reports changes.

/** The entry-level answers (they live on the entry, not in `values`). */
export type FormEntryState = { eventCode: string; matchKey: string | null; alliance: "red" | "blue" | null; teamNumber: number | null; scoutName: string };

export type FormRendererProps = {
  form: Form;
  values: FormValues;
  onValuesChange: (values: FormValues) => void;
  entry: FormEntryState;
  onEntryChange: (patch: Partial<FormEntryState>) => void;
  /** The account's active events (the event picker's choices). */
  events: FtcEvent[];
  /** The teams at the chosen event (the team pickers' choices). */
  teams: TeamOption[];
  /** The team numbers of the chosen alliance in the chosen match, from the schedule (2 in a qualification, up to 3 in the playoffs). Empty until chosen. */
  allianceTeams: number[];
  /** The match picker is the page's (it reuses the practice/qualification/finals picker with the bracket); the renderer places it where the form's match picker sits. */
  renderMatchPicker?: (field: FormField) => ReactNode;
  /** Required-answer problems, by storage key (`t1_notes`) or entry key (`eventCode`, `match`, `alliance`, `teamNumber`). */
  errors?: Record<string, string>;
  /** Where photos go (null until the event and team are known). */
  photoTarget?: PhotoTarget | null;
  onPendingPhotos?: (storageKey: string, ids: string[]) => void;
  /** Plan versus actual: the plan entry found for this event, match and alliance (null when there is none yet). Only read when the form has `compareWith`. */
  plan?: PlanCandidate | null;
  /** Reported whenever the number of differences or the linked plan changes. */
  onPlanChange?: (info: { differences: number; linkedEntryId: string | null }) => void;
  disabled?: boolean;
  /** P28: a category's heading when the form wants it to say more than its title (the Lead Scout's "RED / 1111, 2222"). */
  sectionTitle?: (section: FormSection) => string | undefined;
  /** P28: categories tinted with the chosen alliance's colour. */
  tintedSections?: ReadonlySet<string>;
  /** P29: a line under a field (by its key), e.g. "Suggested from FIRST data: rookie year 2026". */
  fieldHints?: Record<string, string>;
  /** P29: with only one active event the event picker is left out (the page already uses that event). */
  hideEventPickerIfSingle?: boolean;
};

const ALLIANCE = {
  red: { label: "Red", tint: "border-red-400/40 bg-red-500/10", text: "text-red-300" },
  blue: { label: "Blue", tint: "border-blue-400/40 bg-blue-500/10", text: "text-blue-300" },
} as const;

export function FormRenderer(props: FormRendererProps) {
  const { form, values, onValuesChange, entry, onEntryChange, events, teams, allianceTeams, renderMatchPicker, errors = {}, photoTarget = null, onPendingPhotos, plan, onPlanChange, disabled, sectionTitle, tintedSections, fieldHints, hideEventPickerIfSingle } = props;

  const visible = useMemo(() => visibleFieldKeys(form, values), [form, values]);
  // Keys the person has changed themselves: the plan and the schedule never overwrite those.
  const touched = useRef(new Set<string>());
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  });

  const setValue = (key: string, value: FormValue) => {
    touched.current.add(key);
    onValuesChange({ ...valuesRef.current, [key]: value });
  };

  // --- per-team boxes ---------------------------------------------------------------------------------------------
  const maxSlots = Math.max(0, ...form.sections.flatMap((s) => (s.groups ?? []).filter((g) => g.repeat).map((g) => g.repeat!.maxSlots)));
  const slotCount = maxSlots > 0 ? slotCountFor(allianceTeams.length || 2, maxSlots) : 0;

  // The schedule fills each box's team picker (until the person corrects it).
  const teamKeys = useMemo(() => form.sections.flatMap((s) => s.fields.filter((f) => f.type === "teamPicker" && repeatGroupOf(s, f)).map((f) => f.key)), [form]);
  const allianceSig = allianceTeams.join(",");
  useEffect(() => {
    if (teamKeys.length === 0) return;
    let next: FormValues | null = null;
    allianceTeams.forEach((team, i) => {
      for (const key of teamKeys) {
        const k = slotKey(i + 1, key);
        if (touched.current.has(k) || valuesRef.current[k] === team) continue;
        next ??= { ...valuesRef.current };
        next[k] = team;
      }
    });
    if (next) onValuesChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allianceSig]);

  // --- plan versus actual ---------------------------------------------------------------------------------------------
  const compare = form.compareWith ?? null;
  const pairs = useMemo(() => (compare ? expandFieldMap(form, compare.fieldMap, slotCount || 2) : []), [form, compare, slotCount]);
  const planValues = plan?.values ?? null;
  useEffect(() => {
    if (!compare || !planValues) return;
    const next = prefillFromPlan(pairs, valuesRef.current, planValues, touched.current);
    if (next !== valuesRef.current) onValuesChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planValues, pairs]);
  const diffs = useMemo(() => (compare && planValues ? diffAgainstPlan(pairs, values, planValues) : []), [compare, planValues, pairs, values]);
  const diffByKey = useMemo(() => new Map<string, PlanDifference>(diffs.map((d) => [d.key, d])), [diffs]);
  const linkedId = plan?.id ?? null;
  useEffect(() => {
    if (compare) onPlanChange?.({ differences: diffs.length, linkedEntryId: linkedId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffs.length, linkedId, !!compare]);

  const fieldByKey = useMemo(() => new Map(form.sections.flatMap((s) => s.fields).map((f) => [f.key, f])), [form]);
  const noteFor = (storageKey: string, baseKey: string): string | undefined => {
    const d = diffByKey.get(storageKey);
    return d ? plannedText(fieldByKey.get(baseKey), d.planned) : undefined;
  };

  // --- drawing ---------------------------------------------------------------------------------------------------------
  const control = (field: FormField, storageKey: string, extra: Partial<Parameters<typeof RenderedField>[0]> = {}) => {
    const note = noteFor(storageKey, field.key);
    const hint = fieldHints?.[field.key];
    if (field.type === "checkbox") {
      return (
        <div key={storageKey} data-field-key={storageKey}>
          <div className="flex items-center gap-1">
            <CheckboxTile label={field.label} checked={values[storageKey] === true} disabled={disabled} onChange={(v) => setValue(storageKey, v)} />
            {note && <PlanDiffIcon text={note} />}
          </div>
          {hint && <p className="mt-1 px-1 text-xs text-[var(--muted-foreground)]" data-testid={`hint-${field.key}`}>{hint}</p>}
        </div>
      );
    }
    if (hint) extra = { ...extra, field: { ...field, helpText: hint } };
    return (
      <RenderedField
        key={storageKey}
        form={form}
        field={field}
        value={values[storageKey]}
        storageKey={storageKey}
        locked={!!disabled}
        error={errors[storageKey]}
        onChange={(k, v) => setValue(k, v)}
        teams={teams}
        photoTarget={photoTarget}
        onPendingPhotos={onPendingPhotos}
        planNote={note}
        {...extra}
      />
    );
  };

  const systemField = (field: FormField): ReactNode => {
    switch (field.type) {
      case "eventPicker":
        if (hideEventPickerIfSingle && events.length === 1) return null;
        return (
          <div key={field.id} data-field-key={field.key}>
            <FieldLabel htmlFor="form-event" label={field.label} required />
            <SelectField
              id="form-event"
              value={entry.eventCode}
              options={events.map((e) => ({ value: e.code, label: e.name }))}
              disabled={disabled || events.length === 0}
              placeholder={events.length === 0 ? "No active events" : "Choose an event"}
              onChange={(code) => onEntryChange({ eventCode: code })}
            />
            {errors.eventCode && <p role="alert" className="mt-1 text-xs font-medium text-red-300">{errors.eventCode}</p>}
          </div>
        );
      case "matchPicker":
        return (
          <div key={field.id} data-field-key={field.key}>
            {renderMatchPicker ? renderMatchPicker(field) : null}
            {errors.match && <p role="alert" className="mt-1 text-xs font-medium text-red-300">{errors.match}</p>}
          </div>
        );
      case "alliancePicker":
        return (
          <div key={field.id} data-field-key={field.key}>
            <FieldLabel label={field.label} required />
            <div role="radiogroup" aria-label={field.label} className="grid grid-cols-2 gap-2">
              {(["red", "blue"] as const).map((side) => {
                const on = entry.alliance === side;
                return (
                  <button
                    key={side}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => onEntryChange({ alliance: side })}
                    data-testid={`alliance-${side}`}
                    className={cn("min-h-12 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors", on ? `${ALLIANCE[side].tint} ring-2 ring-[var(--color-primary)]` : "glass-card border-[var(--glass-border)] text-[var(--muted-foreground)]")}
                  >
                    <span className={on ? ALLIANCE[side].text : undefined}>{ALLIANCE[side].label}</span>
                  </button>
                );
              })}
            </div>
            {errors.alliance && <p role="alert" className="mt-1 text-xs font-medium text-red-300">{errors.alliance}</p>}
          </div>
        );
      case "teamPicker":
        return (
          <div key={field.id} data-field-key={field.key}>
            <FieldLabel htmlFor="form-team" label={field.label} required />
            <TeamSelect id="form-team" label={field.label} value={entry.teamNumber ?? ""} teams={teams} disabled={disabled} invalid={!!errors.teamNumber} onChange={(t) => onEntryChange({ teamNumber: t === "" ? null : t })} />
            {errors.teamNumber && <p role="alert" className="mt-1 text-xs font-medium text-red-300">{errors.teamNumber}</p>}
          </div>
        );
      case "scoutName":
        return (
          <div key={field.id} data-field-key={field.key}>
            <FieldLabel htmlFor="form-scout" label={field.label} required />
            <Input id="form-scout" value={entry.scoutName} readOnly disabled aria-readonly />
          </div>
        );
      default:
        return null;
    }
  };

  const renderSection = (section: FormSection) => {
    if (!section.visible) return null;
    const layout = layoutOf(section);
    const shown = (f: FormField) => isSystemField(f) || visible.has(f.key);
    return (
      <section
        key={section.id}
        aria-label={sectionTitle?.(section) ?? section.title}
        className={cn("glass-card flex flex-col gap-4 border p-4", tintedSections?.has(section.id) && entry.alliance ? ALLIANCE[entry.alliance].tint : "border-transparent")}
        data-testid={`form-section-${section.id}`}
      >
        <h2 className={cn("text-sm font-semibold uppercase tracking-wide", tintedSections?.has(section.id) && entry.alliance ? ALLIANCE[entry.alliance].text : "text-[var(--muted-foreground)]")} data-testid="section-title">
          {sectionTitle?.(section) ?? section.title}
        </h2>
        {layout.ungrouped.filter(shown).map((f) => (isSystemField(f) ? systemField(f) : control(f, f.key)))}
        {layout.groups.map(({ group, fields }) => {
          const list = fields.filter(shown);
          if (list.length === 0) return null;
          if (group.repeat) {
            const rep = repeatGroupOf(section, list[0])!;
            const side = entry.alliance;
            return (
              <div key={group.id} className="flex flex-col gap-3" data-testid={`repeat-${group.id}`}>
                <h3 className="text-sm font-semibold">{group.title}</h3>
                {!side && <p className="text-xs text-[var(--muted-foreground)]">Choose an alliance to see its teams.</p>}
                {Array.from({ length: Math.min(slotCount, rep.repeat.maxSlots) }, (_, i) => i + 1).map((slot) => {
                  const teamKey = teamKeys.find((k) => list.some((f) => f.key === k));
                  const team = teamKey ? values[slotKey(slot, teamKey)] : allianceTeams[slot - 1];
                  return (
                    <div key={slot} data-testid={`team-box-${slot}`} data-slot={slot} className={cn("flex flex-col gap-3 rounded-2xl border p-3", side ? ALLIANCE[side].tint : "border-[var(--glass-border)]")}>
                      <div className={cn("text-xs font-semibold uppercase tracking-wide", side ? ALLIANCE[side].text : "text-[var(--muted-foreground)]")}>
                        {side ? ALLIANCE[side].label : "Team"} {slot}
                        {typeof team === "number" ? ` · ${team}` : ""}
                      </div>
                      {list.map((f) => control(f, slotKey(slot, f.key)))}
                    </div>
                  );
                })}
              </div>
            );
          }
          return (
            <div key={group.id} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              {list.map((f) => control(f, f.key))}
            </div>
          );
        })}
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="form-renderer">
      {compare && (
        <p className="glass-card px-4 py-2.5 text-sm" data-testid="plan-summary" role="status">
          {planValues ? (diffs.length === 0 ? "Matches the plan" : `${diffs.length} difference${diffs.length === 1 ? "" : "s"} from plan`) : "No plan was found for this match and alliance, so this form starts empty."}
        </p>
      )}
      {form.sections.map(renderSection)}
    </div>
  );
}
