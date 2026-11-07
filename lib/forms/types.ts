// P21: Form schema v2 — the complete, versioned, serializable definition of a scouting form. It drives everything:
// the scout form UI, scoring, validation, Match Analytics columns, team stats, CSV export/import, practice scouting
// and rescoring. Nothing outside the BIOBUZZ built-in (lib/forms/builtin.ts) names a game element.
//
// Types only; the zod validator is lib/forms/validate.ts, and `Form` here is exactly what that validator produces.

export type FormType = "match-scout";
export type FormStatus = "draft" | "published";

/**
 * Where a form came from. `built-in` lives in code (lib/forms/builtin.ts); `built-in-override` is an account's
 * copy-on-write edit of a built-in (`baseBuiltInId` + `baseBuiltInHash` say what it was copied from); `custom` was
 * made in the builder; `template` came from the template library (P23).
 */
export type FormOrigin = "built-in" | "built-in-override" | "custom" | "template";

/** The five phases every new form starts with, then any custom phase key (lowercase letters, digits, `-`/`_`, up to 24). */
export const STANDARD_PHASES = ["prematch", "auto", "teleop", "endgame", "misc"] as const;
export type StandardPhase = (typeof STANDARD_PHASES)[number];
export type PhaseKey = string;

export type FieldType =
  | "toggle"
  | "counter"
  | "checkbox"
  | "number"
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "rating"
  // system fields (match-scout forms): required, locked, can be moved within Pre-Match but never deleted or retyped
  | "matchPicker"
  | "teamPicker"
  | "scoutName";

export const SYSTEM_FIELD_TYPES = ["matchPicker", "teamPicker", "scoutName"] as const;
export type SystemFieldType = (typeof SYSTEM_FIELD_TYPES)[number];

export const USER_FIELD_TYPES = ["toggle", "counter", "checkbox", "number", "text", "textarea", "select", "radio", "rating"] as const;
export type UserFieldType = (typeof USER_FIELD_TYPES)[number];

export type FieldValue = boolean | number | string;
/** Values keyed by field `key`: what an entry stores, what the form edits, what scoring reads. */
export type FormValues = Record<string, FieldValue>;

/** A simple condition on another field: equals / greater than / checked. A field with `visibleWhen` is shown (and counted) only while it holds. */
export type VisibleWhen =
  | { fieldKey: string; op: "checked" }
  | { fieldKey: string; op: "equals"; value: string | number | boolean }
  | { fieldKey: string; op: "gt"; value: number };

export type ScoringMode = "none" | "whenOn" | "perTally" | "perUnit" | "byOption";
/**
 * Points for one field. `whenOn`: `value` when a toggle/checkbox is on. `perTally`: `value` per counter tally.
 * `perUnit`: `value` per unit of a number (or rating). `byOption`: the chosen option's own `points`. `cap` bounds the field's points.
 * A field's points roll into its section's phase subtotal.
 */
export type ScoringRule = { mode: ScoringMode; value?: number; cap?: number };

export type FieldOption = { value: string; label: string; points?: number };

export type AggregateKind = "sum" | "avg" | "rate" | "last" | "list";

/** How a field reaches Match Analytics, team stats and CSV. Defaults by type: counter = avg, toggle/checkbox = rate, text = list. */
export type FieldAnalytics = {
  include: boolean;
  /** Column label (default: the field's label). */
  label?: string;
  /** The middle header of the three-tier Match Analytics header (default: the group, else the section title). */
  category?: string;
  aggregate?: AggregateKind;
  /** Overrides the CSV header (default `Phase - Category - Label`). */
  csvHeader?: string;
  /** The game element this field scores on ("Hive"), so Team Profile can group points across phases (default: the group, else the label). */
  element?: string;
};

/**
 * Labels the built-in logic reads instead of hard-coded keys (P21). A form without a role simply doesn't get the behaviour.
 *  - primaryScoring: the form's headline scoring element(s).
 *  - reliability: a robot-failure incident (Team Breakdown's reliability pill is built from these).
 *  - neverStarted / died / disabled / recoveredFromFreeze: incidents the auto-flag rules reason about.
 *  - comments: the text field whose value is mirrored to the entry's summary comment (what Match Analytics and Team Profile show).
 * A field can carry several roles (BIOBUZZ's "Died During Match" is both a reliability incident and `died`).
 */
export const STAT_ROLES = ["primaryScoring", "reliability", "neverStarted", "died", "disabled", "recoveredFromFreeze", "comments"] as const;
export type StatRole = (typeof STAT_ROLES)[number];

export type FieldUi = {
  size?: "sm" | "md" | "lg";
  icon?: string;
  /** A theme-safe colour token (never a raw colour), so every theme stays legible. */
  color?: "default" | "primary" | "secondary" | "accent" | "success" | "warning" | "danger";
  width?: "full" | "half";
};

export type FormField = {
  /** Stable, never reused: what the builder tracks a field by, even if its key or label changes. */
  id: string;
  /** Unique data key: used in storage, CSV and analytics. Renaming needs a `keyAliases` entry on the form. */
  key: string;
  type: FieldType;
  label: string;
  helpText?: string;
  required?: boolean;
  default?: FieldValue;
  visibleWhen?: VisibleWhen;
  /** The sub-group (H2) this field sits in, within its section. */
  groupId?: string;
  ui?: FieldUi;
  placeholder?: string;
  /** counter */
  min?: number;
  max?: number;
  step?: number;
  /** number */
  decimals?: number;
  /** select / radio */
  options?: FieldOption[];
  /** rating: 1..scale */
  scale?: number;
  scoring?: ScoringRule;
  analytics?: FieldAnalytics;
  statRoles?: StatRole[];
  /** Auto-flag: a value above this is "unrealistic scoring" (counters/numbers). */
  unrealisticAbove?: number;
  /** A short scouting tip shown while filling the form (P22). */
  tip?: string;
};

export type FormGroup = { id: string; title: string };

export type FormSection = {
  id: string;
  title: string;
  phase: PhaseKey;
  groups?: FormGroup[];
  fields: FormField[];
  visible: boolean;
  /** A theme-safe accent colour token (P22). */
  accent?: FieldUi["color"];
};

export type Form = {
  id: string;
  name: string;
  description: string;
  formType: FormType;
  /** Season / game tags, free-form ("biobuzz", "2026"). */
  tags: string[];
  version: number;
  status: FormStatus;
  scoringEnabled: boolean;
  sections: FormSection[];
  origin: FormOrigin;
  baseBuiltInId?: string;
  /** The built-in's content hash when this override was made, to notice later changes to the code-defined original. */
  baseBuiltInHash?: string;
  templateId?: string;
  templateVersion?: number;
  /** Old key -> current key, so entries stored under a renamed key still read correctly. */
  keyAliases?: Record<string, string>;
  /** Custom phase labels (key -> label) for phases outside the five standard ones. */
  phaseLabels?: Record<string, string>;
  createdBy: string;
  createdAt?: number;
  updatedAt?: number;
};

export const PHASE_LABELS: Record<StandardPhase, string> = {
  prematch: "Pre-Match",
  auto: "Autonomous",
  teleop: "Teleoperated",
  endgame: "Endgame",
  misc: "Misc",
};

export function phaseLabel(form: Pick<Form, "phaseLabels">, phase: PhaseKey): string {
  return form.phaseLabels?.[phase] ?? PHASE_LABELS[phase as StandardPhase] ?? phase;
}
