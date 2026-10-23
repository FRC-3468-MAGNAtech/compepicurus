"use client";

import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarX2, CheckCircle2, Send, UserCog } from "lucide-react";
import Link from "next/link";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CounterControl } from "@/components/scout/counter-control";
import { FieldToggle } from "@/components/scout/field-toggle";
import { CheckboxTile } from "@/components/scout/checkbox-tile";
import { SectionNav, type ScoutSection } from "@/components/scout/section-nav";
import { ScoreBar } from "@/components/scout/score-bar";
import { MatchPickerDialog, type AssignedMatch } from "@/components/scout/match-picker-dialog";
import { TeamPickerDialog } from "@/components/scout/team-picker-dialog";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ScoreBreakdown } from "@/lib/scout-entries";
import {
  BIOBUZZ_FORM_SCHEMA,
  calculateScore,
  defaultValuesForSchema,
  type FieldValue,
  type FormValues,
  type ScoutFormField,
  type ScoutFormSchema,
} from "@/lib/scout-form/schema";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { FtcEvent } from "@/lib/ftc/types";

export type ScoutFormMode = "event" | "practice" | "live" | "lobby";
export type ScoutFormLayout = "page" | "side-panel";

export type ScoutFormValues = {
  /** Schema-driven field values — scoring fields (toggle/counter), unscored checkbox flags, and text fields like comments. */
  fields: FormValues;
  teamNumber: number | null;
  match: AssignedMatch | null;
  scoutName: string;
};

export type ScoutFormPrefill = {
  match?: AssignedMatch | null;
  teamNumber?: number | null;
  scoutName?: string;
  fields?: Partial<FormValues>;
};

export type ScoutFormHandle = {
  validate: () => boolean;
  getValues: () => ScoutFormValues;
  reset: () => void;
};

export type ScoutFormProps = {
  /** Defaults to the active season's form (BIOBUZZ). */
  schema?: ScoutFormSchema;
  mode: ScoutFormMode;
  /** Active event context — only used to look up matches/teams; omit for modes with no live event (e.g. a standalone practice session). */
  activeEvent?: FtcEvent | null;
  prefill?: ScoutFormPrefill;
  /** Keys shown but not editable: "match", "teamNumber", or any schema field key. Scout Name is always read-only regardless of this list. */
  lockedFields?: string[];
  /** Hides the Assigned Match section's pick/Request Sub-In controls (practice-style modes). */
  hideMatchPicker?: boolean;
  /** False when the parent supplies its own sticky bottom buttons — use the ref handle to drive submission instead. */
  showSubmitButton?: boolean;
  /** 'side-panel' is a compact, scrollable variant for sitting beside a video — no section nav, tighter spacing. */
  layout?: ScoutFormLayout;
  onChange?: (values: ScoutFormValues, score: ScoreBreakdown) => void;
  /** May return a Promise (e.g. the parent's saveEntry()) — the success animation and reset only fire once it resolves. A thrown/rejected call leaves the form as-is so the parent can show its own error state. */
  onSubmit?: (values: ScoutFormValues, score: ScoreBreakdown) => void | Promise<void>;
};

const GENERAL_FLAG_SECTION_NOTE = "These don't affect score but are saved with the submission.";

function fieldId(key: string) {
  return `scout-field-${key}`;
}

function RenderedField({
  field,
  value,
  locked,
  onChange,
}: {
  field: ScoutFormField;
  value: FieldValue | undefined;
  locked: boolean;
  onChange: (key: string, value: FieldValue) => void;
}) {
  switch (field.type) {
    case "toggle":
      return (
        <FieldToggle
          label={field.label}
          pointsWhenOn={field.points ?? 0}
          checked={Boolean(value)}
          disabled={locked}
          onChange={(v) => onChange(field.key, v)}
        />
      );
    case "counter":
      return (
        <CounterControl
          label={field.label}
          pointsPer={field.points ?? 0}
          value={Number(value) || 0}
          disabled={locked}
          onChange={(v) => onChange(field.key, v)}
        />
      );
    case "text":
      return (
        <div>
          <Label htmlFor={fieldId(field.key)}>{field.label}</Label>
          <Textarea
            id={fieldId(field.key)}
            rows={3}
            value={String(value ?? "")}
            disabled={locked}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      );
    case "readonly":
      return (
        <div>
          <Label htmlFor={fieldId(field.key)}>{field.label}</Label>
          <Input id={fieldId(field.key)} value={String(value ?? "")} readOnly disabled className="text-[var(--muted-foreground)]" />
        </div>
      );
    case "pick":
      // No field in the current BIOBUZZ schema uses this — a generic,
      // minimal fallback so a future schema can declare one without
      // <ScoutForm/> needing a new field-type case.
      return (
        <div className="glass-card flex items-center justify-between gap-3 p-4">
          <div className="text-sm font-semibold">{field.label}</div>
          <div className="text-sm text-[var(--muted-foreground)]">{value === undefined || value === "" ? "—" : String(value)}</div>
        </div>
      );
    case "checkbox":
      // Rendered in batched groups by renderFieldList below, never alone.
      return null;
  }
}

/** Groups consecutive `checkbox` fields into one flex-wrap row (matching the compact incident-flag layout), rendering every other type as its own full-width block — order-preserving. */
function renderFieldList(
  fields: ScoutFormField[],
  values: FormValues,
  isLocked: (key: string) => boolean,
  onChange: (key: string, value: FieldValue) => void
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let checkboxBuffer: ScoutFormField[] = [];

  const flushCheckboxes = () => {
    if (checkboxBuffer.length === 0) return;
    nodes.push(
      <div key={`checkbox-group-${nodes.length}`} className="flex flex-wrap gap-2">
        {checkboxBuffer.map((f) => (
          <CheckboxTile
            key={f.key}
            label={f.label}
            checked={Boolean(values[f.key])}
            disabled={isLocked(f.key)}
            onChange={(v) => onChange(f.key, v)}
          />
        ))}
      </div>
    );
    checkboxBuffer = [];
  };

  for (const field of fields) {
    if (field.type === "checkbox") {
      checkboxBuffer.push(field);
      continue;
    }
    flushCheckboxes();
    nodes.push(<RenderedField key={field.key} field={field} value={values[field.key]} locked={isLocked(field.key)} onChange={onChange} />);
  }
  flushCheckboxes();
  return nodes;
}

function matchLabel(assigned: AssignedMatch) {
  return `${assigned.type} ${MATCH_TYPE_PREFIX[assigned.type]}${assigned.match.matchNumber}`;
}

export const ScoutForm = forwardRef<ScoutFormHandle, ScoutFormProps>(function ScoutForm(
  {
    schema = BIOBUZZ_FORM_SCHEMA,
    mode,
    activeEvent = null,
    prefill,
    lockedFields = [],
    hideMatchPicker = false,
    showSubmitButton = true,
    layout = "page",
    onChange,
    onSubmit,
  },
  ref
) {
  const [assignedMatch, setAssignedMatch] = useState<AssignedMatch | null>(prefill?.match ?? null);
  const [teamNumber, setTeamNumber] = useState<number | null>(prefill?.teamNumber ?? null);
  const [values, setValues] = useState<FormValues>(() => ({ ...defaultValuesForSchema(schema), ...prefill?.fields } as FormValues));

  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [subInRequested, setSubInRequested] = useState(false);
  const [validation, setValidation] = useState<{ match?: boolean; team?: boolean }>({});
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const scoutName = prefill?.scoutName ?? "";
  const isLocked = (key: string) => lockedFields.includes(key);

  // Re-applies prefill when the *identifying* values actually change (a new
  // match/team/scout to prefill as), not on every re-render — a reference
  // change in `prefill` alone (e.g. the parent recreating the object) would
  // otherwise clobber in-progress edits.
  useEffect(() => {
    if (prefill?.match !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssignedMatch(prefill.match);
    }
  }, [prefill?.match?.type, prefill?.match?.match.matchNumber, prefill?.match]);
  useEffect(() => {
    if (prefill?.teamNumber !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeamNumber(prefill.teamNumber);
    }
  }, [prefill?.teamNumber]);

  const reset = () => {
    setAssignedMatch(prefill?.match ?? null);
    setTeamNumber(prefill?.teamNumber ?? null);
    setValues({ ...defaultValuesForSchema(schema), ...prefill?.fields } as FormValues);
    setValidation({});
  };

  const score = calculateScore(schema, values);
  const currentValues = (): ScoutFormValues => ({ fields: values, teamNumber, match: assignedMatch, scoutName });

  useEffect(() => {
    onChange?.(currentValues(), score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, teamNumber, assignedMatch]);

  const runValidation = () => {
    const missingMatch = !hideMatchPicker && !assignedMatch;
    const missingTeam = teamNumber === null;
    setValidation({ match: missingMatch, team: missingTeam });
    return !missingMatch && !missingTeam;
  };

  useImperativeHandle(ref, () => ({
    validate: runValidation,
    getValues: currentValues,
    reset,
  }));

  useEffect(() => {
    if (layout !== "page") return;
    const sectionIds = [
      ...(hideMatchPicker ? [] : ["assigned-match"]),
      "pre-match",
      ...schema.sections.map((s) => s.id),
    ];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSectionId(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [layout, hideMatchPicker, schema]);

  const setFieldValue = (key: string, value: FieldValue) => setValues((v) => ({ ...v, [key]: value }));

  const requestSubIn = () => {
    setSubInRequested(true);
    setTimeout(() => setSubInRequested(false), 3000);
  };

  const handleSubmit = async () => {
    if (!runValidation()) {
      document.getElementById(hideMatchPicker ? "pre-match" : "assigned-match")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit?.(currentValues(), score);
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 2200);
      reset();
    } catch {
      // The parent's onSubmit is responsible for surfacing its own error UI.
    } finally {
      setSubmitting(false);
    }
  };

  const sections: ScoutSection[] = [
    ...(hideMatchPicker ? [] : [{ id: "assigned-match", label: "Assigned Match" }]),
    { id: "pre-match", label: "Pre-Match" },
    ...schema.sections.map((s) => ({ id: s.id, label: s.label })),
  ];

  const compact = layout === "side-panel";

  return (
    <div data-scout-form-mode={mode} className={cn("flex flex-col gap-4", compact ? "pb-2" : "pb-4")}>
      {!compact && <SectionNav sections={sections} activeId={activeSectionId} />}

      {!hideMatchPicker && (
        <section id="assigned-match" className="scroll-mt-20">
          <GlassPanel className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Assigned Match</h2>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="gap-2"
                disabled={isLocked("match")}
                onClick={() => setMatchDialogOpen(true)}
              >
                {assignedMatch ? matchLabel(assignedMatch) : "Pick match"}
              </Button>
              {!isLocked("match") && (
                <Button size="lg" variant="glass" className="gap-2" onClick={requestSubIn}>
                  <UserCog className="h-4 w-4" /> Request Sub-In
                </Button>
              )}
              {subInRequested && <Badge variant="success">Sub-in request sent</Badge>}
            </div>
            {validation.match && <p className="text-sm font-medium text-red-300">Select a match before submitting.</p>}
            {assignedMatch && (
              <div className="glass-card flex flex-wrap items-center gap-3 p-4 text-sm">
                <Badge variant="accent">{matchLabel(assignedMatch)}</Badge>
                <span className="text-red-300">{assignedMatch.match.redTeams.join(", ") || "TBD"}</span>
                <span className="text-[var(--muted-foreground)]">vs</span>
                <span className="text-blue-300">{assignedMatch.match.blueTeams.join(", ") || "TBD"}</span>
              </div>
            )}
          </GlassPanel>
        </section>
      )}

      <section id="pre-match" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Pre-Match</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="scout-name">Scout name</Label>
              <Input id="scout-name" value={scoutName} readOnly disabled className="text-[var(--muted-foreground)]" />
            </div>
            <div>
              <Label htmlFor="team-number-picker">Team number</Label>
              {!activeEvent && !isLocked("teamNumber") ? (
                <NoEventNotice />
              ) : (
                <Button
                  id="team-number-picker"
                  size="lg"
                  variant={teamNumber ? "primary" : "glass"}
                  className={cn("w-full", validation.team && "ring-2 ring-red-400")}
                  disabled={isLocked("teamNumber")}
                  onClick={() => setTeamDialogOpen(true)}
                >
                  {teamNumber ? `Team ${teamNumber}` : "Pick team"}
                </Button>
              )}
            </div>
          </div>
          {validation.team && <p className="text-sm font-medium text-red-300">Select a team before submitting.</p>}
        </GlassPanel>
      </section>

      {schema.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-20">
          <GlassPanel className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{section.label}</h2>
            {section.id === "general" && (
              <p className="text-xs text-[var(--muted-foreground)]">{GENERAL_FLAG_SECTION_NOTE}</p>
            )}
            {section.groups
              ? section.groups.map((group, i) => (
                  <div key={i} className="flex flex-col gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{group.label}</h3>
                    {renderFieldList(group.fields, values, isLocked, setFieldValue)}
                  </div>
                ))
              : renderFieldList(section.fields ?? [], values, isLocked, setFieldValue)}
          </GlassPanel>
        </section>
      ))}

      {showSubmitButton && (
        <Button size="lg" className="mt-1 gap-2 self-start" onClick={handleSubmit} disabled={submitting}>
          <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit match"}
        </Button>
      )}

      <ScoreBar score={score} />

      {!hideMatchPicker && (
        <MatchPickerDialog
          open={matchDialogOpen}
          onOpenChange={setMatchDialogOpen}
          activeEvent={activeEvent}
          onSelect={setAssignedMatch}
        />
      )}

      {activeEvent && (
        <TeamPickerDialog
          open={teamDialogOpen}
          onOpenChange={setTeamDialogOpen}
          eventCode={activeEvent.code}
          season={activeEvent.season}
          priorityTeamNumbers={assignedMatch ? [...assignedMatch.match.redTeams, ...assignedMatch.match.blueTeams] : undefined}
          onSelect={setTeamNumber}
        />
      )}

      <AnimatePresence>
        {justSubmitted && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={springSnappy}
            className="glass-strong fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-2xl"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Match logged &mdash; ready for the next one.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function NoEventNotice() {
  return (
    <div className="glass-card flex items-center justify-between gap-3 p-3 text-sm text-[var(--muted-foreground)]">
      <span className="flex items-center gap-2">
        <CalendarX2 className="h-4 w-4 shrink-0" /> No active event
      </span>
      <Link href="/event">
        <Button variant="glass" size="sm">
          Select event
        </Button>
      </Link>
    </div>
  );
}
