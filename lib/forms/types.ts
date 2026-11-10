// P21: Form schema v2 — the complete, versioned, serializable definition of a scouting form. It drives everything:
// the scout form UI, scoring, validation, Match Analytics columns, team stats, CSV export/import, practice scouting
// and rescoring. Nothing outside the BIOBUZZ built-in (lib/forms/builtin.ts) names a game element.
//
// Types only; the zod validator is lib/forms/validate.ts, and `Form` here is exactly what that validator produces.

/**
 * What a form is for (P27). `match-scout` is the original game form. The others are the team's other forms, saved in
 * `formEntries` rather than `scoutEntries`; which system fields each one must carry is `REQUIRED_SYSTEM_FIELDS`. `custom` is any other form
 * an admin makes in the builder.
 */
export const FORM_TYPES = ["match-scout", "lead-scout", "pit-scout", "team-strategy", "match-strategy", "drive-reflection", "helper", "custom"] as const;
export type FormType = (typeof FORM_TYPES)[number];
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
  // P27: a range slider, photos, an ordered step builder and a checkbox grid
  | "slider"
  | "image"
  | "sequence"
  | "matrix"
  // system fields: required where the form type needs them, locked, can be moved within Pre-Match but never deleted or retyped
  | "matchPicker"
  | "teamPicker"
  | "scoutName"
  // P27: the account's active events, and Red or Blue (which pulls that alliance's teams from the schedule)
  | "eventPicker"
  | "alliancePicker";

export const SYSTEM_FIELD_TYPES = ["matchPicker", "teamPicker", "scoutName", "eventPicker", "alliancePicker"] as const;
export type SystemFieldType = (typeof SYSTEM_FIELD_TYPES)[number];

export const USER_FIELD_TYPES = ["toggle", "counter", "checkbox", "number", "text", "textarea", "select", "radio", "rating", "slider", "image", "sequence", "matrix"] as const;
export type UserFieldType = (typeof USER_FIELD_TYPES)[number];

/** The fixed storage key of each system field (it lives on the entry itself: `match`, `teamNumber`, ...). */
export const SYSTEM_FIELD_KEYS: Record<SystemFieldType, string> = {
  matchPicker: "match",
  teamPicker: "teamNumber",
  scoutName: "scoutName",
  eventPicker: "eventCode",
  alliancePicker: "alliance",
};

/**
 * A SYSTEM field is a picker of a system type with its fixed key. A `teamPicker` with any other key (the one inside a per-team repeating group, which
 * holds that slot's team and can be changed) is an ordinary field: it can be moved, duplicated and deleted.
 */
export const isSystemField = (f: { type: string; key: string }): boolean =>
  (SYSTEM_FIELD_TYPES as readonly string[]).includes(f.type) && SYSTEM_FIELD_KEYS[f.type as SystemFieldType] === f.key;

/**
 * The system fields a form of each type must carry (once each, outside any repeating group). A match-scout form has the match, the team and
 * the scout; the others need what their page asks for first. `custom` forms need none.
 */
export const REQUIRED_SYSTEM_FIELDS: Record<FormType, readonly SystemFieldType[]> = {
  "match-scout": ["matchPicker", "teamPicker", "scoutName"],
  "lead-scout": ["eventPicker", "matchPicker", "alliancePicker", "scoutName"],
  "pit-scout": ["eventPicker", "teamPicker", "scoutName"],
  "team-strategy": ["eventPicker", "teamPicker", "scoutName"],
  "match-strategy": ["eventPicker", "alliancePicker", "matchPicker", "scoutName"],
  "drive-reflection": ["eventPicker", "alliancePicker", "matchPicker", "scoutName"],
  helper: ["eventPicker", "scoutName"],
  custom: [],
};

/** One uploaded photo (the `image` field's value is a list of these). */
export type ImageValue = { url: string; pathname: string; size: number; contentType: string };

/** A sticky note (P27/P28): free-form text with a theme-safe colour. */
export type StickyNote = { id: string; text: string; color: string; createdAt: number; pinned?: boolean };

export type FieldValue = boolean | number | string;
/**
 * What one field stores. Most are plain (boolean, number, string); P27 adds a list of step ids (`sequence`), one boolean per cell keyed
 * `${rowKey}_${colKey}` (`matrix`) and a list of photos (`image`).
 */
export type FormValue = FieldValue | string[] | Record<string, boolean> | ImageValue[];
/** Values keyed by field `key`: what an entry stores, what the form edits, what scoring reads. */
export type FormValues = Record<string, FormValue>;

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

/** A step a `sequence` field offers (the pit scout's auto cycle): `maxCount` 1 = once, 0 = as often as wanted; `pin` forces it to the start or end. */
export type SequenceStep = { id: string; label: string; /** What the one-line summary says ("Hive" for the button "Score Into Hive"); the label when absent. */ shortLabel?: string; icon?: string; maxCount: 1 | 0; pin: "first" | "last" | null };

/** A row or column of a `matrix` field. */
export type MatrixAxis = { key: string; label: string };

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
  /** slider: the labels at the two ends, and tick marks along the track (`min`, `max` and `step` are the integer range). */
  endLabels?: { min?: string; max?: string };
  ticks?: boolean;
  /** image: how many photos (default 1) and whether a phone opens its camera. */
  maxCount?: number;
  capture?: boolean;
  /** sequence: the catalog of steps. */
  steps?: SequenceStep[];
  /** matrix: the checkbox grid, and the cells ("row_col") that are not offered (e.g. "Leave" only in Auto). */
  rows?: MatrixAxis[];
  cols?: MatrixAxis[];
  disabledCells?: string[];
};

/**
 * A group whose fields are drawn once per team of the chosen alliance (P27): 2 in qualifications, up to 3 on a playoff alliance (the real
 * size comes from the schedule). Values are stored by slot, `t1_<fieldKey>`, `t2_<fieldKey>`, ... (`slotKey` in lib/forms/repeat.ts).
 */
export type GroupRepeat = { source: "allianceTeams"; maxSlots: number };

export type FormGroup = { id: string; title: string; repeat?: GroupRepeat };

/** The sticky notes side panel (P28): on or off for a form, and whether it starts open. Entries store `stickyNotes: StickyNote[]`. */
export type StickyNotesConfig = { enabled: boolean; defaultOpen: boolean };

/** What an entry's match is compared on to find its plan (`compareWith`). */
export type CompareMatchOn = "eventCode" | "matchKey" | "alliance";

/**
 * Plan versus actual (P27): on a form (Drive Reflection) that reflects on another's entries (Match Strategy). When the event, match and alliance are
 * chosen, the latest entry of `formId` for the same event/match/alliance is found; `fieldMap` (this form's field key -> the plan form's
 * field key; slot keys `t1_role` are mapped per slot automatically) says what to prefill and what to compare.
 */
export type CompareWith = { formId: string; matchOn: CompareMatchOn[]; fieldMap: Record<string, string> };

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
  /** P27: the sticky notes panel setting. */
  stickyNotes?: StickyNotesConfig;
  /** P27: plan versus actual (see CompareWith). */
  compareWith?: CompareWith;
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
