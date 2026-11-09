import type { Form, FormField, FormSection, PhaseKey, StatRole } from "@/lib/forms/types";
import { isSystemField } from "@/lib/forms/types";

// P21: a flat, convenient view of a form's fields for the stats code (team stats, team cards, match breakdown, dashboards): each value
// field with where it sits, the phase its points roll into, its per-tally/per-toggle points, its game element, and its stat roles.
// Everything here is derived from the schema; none of it names a game.

export type FieldMeta = {
  field: FormField;
  section: FormSection;
  sectionId: string;
  /** The title of the sub-group the field sits in, or null. */
  groupLabel: string | null;
  /** The phase the field's points roll into (its section's). */
  phase: PhaseKey;
  /** Points per toggle-on / per counter tally (`whenOn` / `perTally`), when the field scores that way and the value is non-zero. */
  points: number | undefined;
  /** The field scores at all (any mode). */
  scored: boolean;
};

/** Every value field (not the system pickers) in render order: each section's fields as laid out. */
export function formFieldMeta(form: Pick<Form, "sections">): FieldMeta[] {
  const out: FieldMeta[] = [];
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (isSystemField(field)) continue;
      const mode = field.scoring?.mode;
      const base = (mode === "whenOn" || mode === "perTally") && field.scoring?.value ? field.scoring.value : undefined;
      out.push({
        field,
        section,
        sectionId: section.id,
        groupLabel: section.groups?.find((g) => g.id === field.groupId)?.title ?? null,
        phase: section.phase,
        points: base,
        scored: !!mode && mode !== "none",
      });
    }
  }
  return out;
}

/** The game element a field's points belong to: its analytics `element`, else its sub-group, else its own label (so Team Profile can group points across phases). */
export const elementOf = (m: Pick<FieldMeta, "field" | "groupLabel">): string => m.field.analytics?.element ?? m.groupLabel ?? m.field.label;

export const hasRole = (field: Pick<FormField, "statRoles">, role: StatRole): boolean => !!field.statRoles?.includes(role);

/** The fields of a form carrying a stat role, in render order. */
export function fieldsWithRole(form: Pick<Form, "sections">, role: StatRole): FormField[] {
  return formFieldMeta(form)
    .map((m) => m.field)
    .filter((f) => hasRole(f, role));
}

/** The first field with a role (e.g. the one `died` incident), or undefined. */
export const fieldWithRole = (form: Pick<Form, "sections">, role: StatRole): FormField | undefined => fieldsWithRole(form, role)[0];
