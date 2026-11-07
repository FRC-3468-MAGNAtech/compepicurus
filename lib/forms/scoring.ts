import type { Form, FormField, FormValues } from "@/lib/forms/types";
import { visibleFieldKeys } from "@/lib/forms/visibility";

// P21: scoring from the schema. One function used everywhere a form's values become a score: the live scout form,
// practice scouting, CSV import, rescoring and the admin entry editor.

/** What `calculateScore` returns. `auto`/`teleop`/`endgame` mirror `byPhase` (the shape every stored entry and chart already uses); points in any other phase count toward `total` and `byPhase` only. */
export type ScoreResult = { auto: number; teleop: number; endgame: number; total: number; byPhase: Record<string, number> };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

/** Points one field contributes for a value, by its scoring rule, bounded by the rule's `cap`. Fields with no rule, or a rule that doesn't fit their type, give 0. */
export function fieldPoints(field: FormField, value: unknown): number {
  const rule = field.scoring;
  if (!rule || rule.mode === "none") return 0;
  let points = 0;
  switch (rule.mode) {
    case "whenOn":
      points = (field.type === "toggle" || field.type === "checkbox") && value === true ? (rule.value ?? 0) : 0;
      break;
    case "perTally":
      points = field.type === "counter" ? (rule.value ?? 0) * Math.max(0, num(value)) : 0;
      break;
    case "perUnit":
      points = field.type === "number" || field.type === "rating" ? (rule.value ?? 0) * Math.max(0, num(value)) : 0;
      break;
    case "byOption":
      points = field.type === "select" || field.type === "radio" ? ((field.options ?? []).find((o) => o.value === value)?.points ?? 0) : 0;
      break;
  }
  if (rule.cap !== undefined) points = Math.min(points, rule.cap);
  return points;
}

/**
 * The score for a set of values. Only **visible** fields count (a hidden category, or a field whose condition
 * doesn't hold, scores nothing), and a form with `scoringEnabled: false` always scores zero. Points roll into the
 * phase of the section the field sits in.
 */
export function calculateScore(form: Pick<Form, "sections" | "scoringEnabled">, values: FormValues): ScoreResult {
  const byPhase: Record<string, number> = {};
  if (form.scoringEnabled) {
    const visible = visibleFieldKeys(form, values);
    for (const section of form.sections) {
      for (const field of section.fields) {
        if (!field.scoring || field.scoring.mode === "none" || !visible.has(field.key)) continue;
        const points = fieldPoints(field, values[field.key]);
        if (points !== 0) byPhase[section.phase] = (byPhase[section.phase] ?? 0) + points;
      }
    }
  }
  const total = Object.values(byPhase).reduce((a, b) => a + b, 0);
  return { auto: byPhase.auto ?? 0, teleop: byPhase.teleop ?? 0, endgame: byPhase.endgame ?? 0, total, byPhase };
}

/** The shape stored on an entry: the three standard subtotals and the total, plus `byPhase` only when some other phase scored (so BIOBUZZ entries stay byte-identical to before). */
export function storableScore(result: ScoreResult): { auto: number; teleop: number; endgame: number; total: number; byPhase?: Record<string, number> } {
  const extra = Object.entries(result.byPhase).some(([phase, pts]) => phase !== "auto" && phase !== "teleop" && phase !== "endgame" && pts !== 0);
  const base = { auto: result.auto, teleop: result.teleop, endgame: result.endgame, total: result.total };
  return extra ? { ...base, byPhase: result.byPhase } : base;
}

/**
 * The highest score the form can give, where that can be computed: `null` for the total (and for a phase) when some scoring
 * field has no upper bound (a counter with no max and no cap). Conditional fields are assumed reachable.
 */
export function maxScore(form: Pick<Form, "sections" | "scoringEnabled">): { total: number | null; byPhase: Record<string, number | null> } {
  const byPhase: Record<string, number | null> = {};
  if (!form.scoringEnabled) return { total: 0, byPhase };
  for (const section of form.sections) {
    for (const field of section.fields) {
      const rule = field.scoring;
      if (!rule || rule.mode === "none") continue;
      let best: number | null;
      switch (rule.mode) {
        case "whenOn":
          best = Math.max(0, rule.value ?? 0);
          break;
        case "perTally":
          best = field.max !== undefined ? Math.max(0, rule.value ?? 0) * Math.max(0, field.max) : null;
          break;
        case "perUnit":
          best = field.type === "rating" ? Math.max(0, rule.value ?? 0) * (field.scale ?? 0) : field.max !== undefined ? Math.max(0, rule.value ?? 0) * Math.max(0, field.max) : null;
          break;
        case "byOption":
          best = Math.max(0, ...(field.options ?? []).map((o) => o.points ?? 0));
          break;
        default:
          best = 0;
      }
      if (best !== null && rule.cap !== undefined) best = Math.min(best, rule.cap);
      if (rule.cap !== undefined && best === null) best = rule.cap;
      const current = byPhase[section.phase];
      byPhase[section.phase] = current === null || best === null ? null : (current ?? 0) + best;
    }
  }
  const phases = Object.values(byPhase);
  return { total: phases.some((p) => p === null) ? null : phases.reduce<number>((a, b) => a + (b ?? 0), 0), byPhase };
}
