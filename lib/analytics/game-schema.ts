import type { ScoutEntry } from "@/lib/scout-entries";
import type { MatchType } from "@/lib/ftc/types";
import { BIOBUZZ_FORM, DEFAULT_FORM_ID } from "@/lib/forms/builtin";
import { entryValues } from "@/lib/forms/legacy";
import { resolveAlias } from "@/lib/forms/values";
import { phaseLabel, SYSTEM_FIELD_TYPES, type Form, type FormField, type FormSection } from "@/lib/forms/types";

export type ColumnType =
  | "match"
  | "team"
  | "scoutName"
  | "boolean"
  | "count"
  | "score"
  | "comments"
  | "accuracy"
  | "scriptStatus"
  | "actions"
  | "text"
  | "badge";

export type AnalyticsColumn = {
  key: string;
  phase: string;
  category: string;
  label: string;
  type: ColumnType;
  sortable: boolean;
  sticky?: boolean;
  /** px width — used for both rendering and sticky left-offset math. */
  width: number;
  getValue: (entry: ScoutEntry) => unknown;
  /** Only needed when the natural sort order isn't just getValue() itself (e.g. match type+number). */
  getSortValue?: (entry: ScoutEntry) => number | string;
  /** `type: "badge"` only — a Badge-compatible className for this row's value. */
  getBadgeClassName?: (entry: ScoutEntry) => string;
  /** P21: the schema's own CSV header for this column (default `Phase - Category - Label`). */
  csvHeader?: string;
  /** P21: the form field a column was derived from (absent for the match/team/scout, score, accuracy and action columns): what CSV import coerces cells with. */
  field?: FormField;
};

export type GameSchema = {
  id: string;
  name: string;
  columns: AnalyticsColumn[];
};

export const MATCH_TYPE_PREFIX: Record<MatchType, string> = {
  Practice: "P",
  Qualification: "Q",
  Playoff: "F",
};

const MATCH_TYPE_ORDER: Record<MatchType, number> = {
  Practice: 0,
  Qualification: 1,
  Playoff: 2,
};

export function formatMatch(entry: Pick<ScoutEntry, "matchType" | "matchNumber">): string {
  return `${MATCH_TYPE_PREFIX[entry.matchType]}${entry.matchNumber}`;
}

export function matchSortValue(entry: Pick<ScoutEntry, "matchType" | "matchNumber">): number {
  return MATCH_TYPE_ORDER[entry.matchType] * 100_000 + entry.matchNumber;
}

/** The three-tier header text and CSV header for a column: `Phase - Category - Label`, unless the schema overrides it. */
export function csvHeaderFor(col: Pick<AnalyticsColumn, "phase" | "category" | "label" | "csvHeader">): string {
  return col.csvHeader ?? `${col.phase} - ${col.category} - ${col.label}`;
}

// --- deriving columns from a form (P21) ---------------------------------------------------------------------

const STANDARD_SCORE_LABEL: Record<string, string> = { auto: "Auto", teleop: "Teleop", endgame: "Endgame" };
const STANDARD_SCORE_KEY: Record<string, string> = { auto: "scoreAuto", teleop: "scoreTeleop", endgame: "scoreEndgame" };

function fieldColumnType(f: FormField): ColumnType | null {
  switch (f.type) {
    case "toggle":
    case "checkbox":
      return "boolean";
    case "counter":
    case "number":
    case "rating":
      return "count";
    case "select":
    case "radio":
    case "text":
      return "text";
    case "textarea":
      return "comments";
    default:
      return null;
  }
}

const WIDTH: Record<string, number> = { boolean: 120, count: 110, text: 140, comments: 260 };

function fieldColumn(form: Form, section: FormSection, field: FormField, type: ColumnType, valuesOf: (e: ScoutEntry) => Record<string, unknown>): AnalyticsColumn {
  const group = section.groups?.find((g) => g.id === field.groupId)?.title;
  const key = field.key;
  const getValue = (e: ScoutEntry): unknown => {
    const v = valuesOf(e)[key];
    if (v === undefined) return null;
    if (type === "boolean") return v === true;
    if (type === "count") return typeof v === "number" ? v : Number(v) || 0;
    if (field.type === "select" || field.type === "radio") return field.options?.find((o) => o.value === v)?.label ?? String(v);
    return typeof v === "string" ? v : String(v);
  };
  return {
    key,
    phase: section.title,
    category: field.analytics?.category ?? group ?? section.title,
    label: field.analytics?.label ?? field.label,
    type,
    sortable: type !== "comments",
    width: WIDTH[type] ?? 120,
    getValue,
    ...(field.analytics?.csvHeader ? { csvHeader: field.analytics.csvHeader } : {}),
    field,
  };
}

/**
 * The Match Analytics table for a form, derived entirely from the schema: the sticky Match / Team / Scout columns, one column per
 * field with analytics `include` (three-tier header: section title > category > label), the per-phase score columns and Total (when
 * scoring is on), the comments, the accuracy columns (when scoring is on) and the row actions. For BIOBUZZ this reproduces the
 * previous hard-coded columns exactly (a regression test pins them).
 */
export function buildGameSchema(form: Form): GameSchema {
  const valuesOf = (e: ScoutEntry) => entryValues(e, { keyAliases: form.keyAliases });
  const columns: AnalyticsColumn[] = [];

  columns.push(
    {
      key: "match",
      phase: "Information",
      category: "Information",
      label: "Match",
      type: "match",
      sortable: true,
      sticky: true,
      width: 90,
      getValue: formatMatch,
      getSortValue: matchSortValue,
    },
    {
      key: "team",
      phase: "Information",
      category: "Information",
      label: "Team",
      type: "team",
      sortable: true,
      sticky: true,
      width: 90,
      getValue: (e) => e.teamNumber,
    },
    {
      key: "scout",
      phase: phaseLabel(form, "prematch"),
      category: "Pre-Match",
      label: "Scout",
      type: "scoutName",
      sortable: true,
      sticky: true,
      width: 150,
      getValue: (e) => e.scoutName,
    }
  );

  const commentColumns: AnalyticsColumn[] = [];
  for (const section of form.sections) {
    for (const field of section.fields) {
      if ((SYSTEM_FIELD_TYPES as readonly string[]).includes(field.type)) continue;
      if (field.analytics && field.analytics.include === false) continue;
      const type = fieldColumnType(field);
      if (!type) continue;
      (type === "comments" ? commentColumns : columns).push(fieldColumn(form, section, field, type, valuesOf));
    }
  }

  if (form.scoringEnabled) {
    const scoringPhases: string[] = [];
    for (const s of form.sections) {
      if (s.fields.some((f) => f.scoring && f.scoring.mode !== "none") && !scoringPhases.includes(s.phase)) scoringPhases.push(s.phase);
    }
    for (const phase of scoringPhases) {
      const standard = phase in STANDARD_SCORE_KEY;
      columns.push({
        key: standard ? STANDARD_SCORE_KEY[phase] : `score_${phase}`,
        phase: "General",
        category: "Score",
        label: STANDARD_SCORE_LABEL[phase] ?? phaseLabel(form, phase),
        type: "count",
        sortable: true,
        width: 110,
        // null (shown as an em dash) for an entry whose form had scoring off, in a table that mixes forms
        getValue: (e) => (e.scored === false ? null : standard ? (e.score as unknown as Record<string, number>)[phase] : (e.score.byPhase?.[phase] ?? 0)),
      });
    }
    columns.push({ key: "scoreTotal", phase: "General", category: "Score", label: "Total", type: "score", sortable: true, width: 110, getValue: (e) => (e.scored === false ? null : e.score.total) });
  }

  columns.push(...commentColumns);

  if (form.scoringEnabled) {
    columns.push(
      { key: "accuracy", phase: "General", category: "Accuracy Script", label: "Alliance Accuracy", type: "accuracy", sortable: true, width: 150, getValue: (e) => e.accuracy?.value ?? null },
      { key: "scriptStatus", phase: "General", category: "Script Status", label: "Script Status", type: "scriptStatus", sortable: true, width: 140, getValue: (e) => e.accuracy?.status ?? "not-applicable" }
    );
  }
  columns.push({ key: "actions", phase: "Actions", category: "Actions", label: "Actions", type: "actions", sortable: false, width: 160, getValue: () => null });

  return { id: form.id, name: form.name, columns };
}

/**
 * One form that has every field any of `forms` has, so a single table (and its CSV) can show entries from different forms or different
 * versions of one form together. Sections merge by id and fields by key (the first form's wins); a field whose key was renamed (it's an
 * alias source in any form) is dropped in favour of its current key, since `entryValues` re-keys old values to the current one.
 * Scoring is on if any form scores. With one form this is that form.
 */
export function unionForms(forms: readonly Form[]): Form {
  if (forms.length === 1) return forms[0];
  const [first, ...rest] = forms;
  const aliases: Record<string, string> = {};
  for (const f of forms) Object.assign(aliases, f.keyAliases ?? {});

  const sections: FormSection[] = first.sections.map((s) => ({ ...s, groups: s.groups ? [...s.groups] : undefined, fields: [...s.fields] }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const keys = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
  for (const form of rest) {
    for (const s of form.sections) {
      let target = byId.get(s.id);
      if (!target) {
        target = { ...s, groups: s.groups ? [...s.groups] : undefined, fields: [] };
        sections.push(target);
        byId.set(s.id, target);
      }
      for (const field of s.fields) {
        if (keys.has(field.key)) continue;
        keys.add(field.key);
        target.fields.push(field);
        const group = s.groups?.find((g) => g.id === field.groupId);
        if (group && !target.groups?.some((g) => g.id === group.id)) target.groups = [...(target.groups ?? []), group];
      }
    }
  }
  // drop renamed fields whose current key exists
  for (const s of sections) s.fields = s.fields.filter((f) => !(f.key in aliases && keys.has(resolveAlias(f.key, aliases)) && resolveAlias(f.key, aliases) !== f.key));

  return { ...first, sections, scoringEnabled: forms.some((f) => f.scoringEnabled), keyAliases: Object.keys(aliases).length > 0 ? aliases : undefined };
}

/** The built-in forms' analytics tables, by form id. Account forms (custom or edited) are derived on demand with `buildGameSchema`. */
export const GAMES: Record<string, GameSchema> = {
  [BIOBUZZ_FORM.id]: buildGameSchema(BIOBUZZ_FORM),
};

export const BIOBUZZ_SCHEMA: GameSchema = GAMES[BIOBUZZ_FORM.id];

export const DEFAULT_GAME_ID = DEFAULT_FORM_ID;

/**
 * P9: Match Analytics' "Practice Scouted Matches" toggle inserts a Session
 * ID column and a source/mode badge right after the sticky Scout column —
 * the real-event schema is never mutated, so the normal (unchecked) view's
 * columns are untouched. `getValue`/`getBadgeClassName` read `source`/`mode`
 * straight off the entry — practice-mode's display entries carry a
 * session-derived `accuracy` by then (see docs/ASSUMPTIONS.md, P9), so the
 * existing "accuracy"/"scriptStatus" columns need no changes at all.
 */
export function withPracticeColumns(schema: GameSchema): GameSchema {
  const sessionIdColumn: AnalyticsColumn = {
    key: "sessionId",
    phase: "Information",
    category: "Information",
    label: "Session ID",
    type: "text",
    sortable: true,
    width: 110,
    getValue: (e) => e.sessionId ?? "—",
  };
  const sourceColumn: AnalyticsColumn = {
    key: "practiceSource",
    phase: "Information",
    category: "Information",
    label: "Source",
    type: "badge",
    sortable: true,
    width: 150,
    getValue: (e) =>
      e.source === "live" ? "Live" : e.mode === "competitive" ? "Practice · Competitive" : e.mode === "trial" ? "Practice · Trial" : "Practice",
    getBadgeClassName: (e) =>
      e.source === "live"
        ? "bg-violet-500/15 text-violet-300 border border-violet-400/30"
        : "bg-sky-500/15 text-sky-300 border border-sky-400/30",
  };
  const insertAt = schema.columns.findIndex((c) => c.key === "scout") + 1;
  const columns = [...schema.columns];
  columns.splice(insertAt, 0, sessionIdColumn, sourceColumn);
  return { ...schema, columns };
}
