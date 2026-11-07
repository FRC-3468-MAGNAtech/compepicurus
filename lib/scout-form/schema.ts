// P21: this module used to HOLD the hard-coded BIOBUZZ form and its scoring. The form definition now lives in schema v2 (lib/forms/*): the
// types in lib/forms/types.ts, the validator in lib/forms/validate.ts, scoring in lib/forms/scoring.ts, and BIOBUZZ is one built-in
// among others (lib/forms/builtin.ts). What remains here are the pre-v2 names, as thin aliases, so existing imports (and the tests written
// against them) keep resolving. New code should import from `@/lib/forms/*` directly and read forms through the store/context.

import type { ScoutEntryFields } from "@/lib/scout-entries";
import { BIOBUZZ_FORM, BUILTIN_FORMS, DEFAULT_FORM_ID as BUILTIN_DEFAULT_FORM_ID } from "@/lib/forms/builtin";
import { legacyFieldsFromValues } from "@/lib/forms/legacy";
import { calculateScore as scoreForm } from "@/lib/forms/scoring";
import { defaultValues, valueFields } from "@/lib/forms/values";
import type { FieldValue, Form, FormField, FormValues } from "@/lib/forms/types";

export type { FieldValue, FormValues };
export type ScoutFormSchema = Form;
export type ScoutFormField = FormField;

export const BIOBUZZ_FORM_SCHEMA: Form = BIOBUZZ_FORM;
export const DEFAULT_FORM_ID = BUILTIN_DEFAULT_FORM_ID;
/** The forms defined in code, by id (an account's own forms are resolved through the form store instead). */
export const FORMS: Record<string, Form> = { ...BUILTIN_FORMS };

/** A built-in form by id, defaulting to BIOBUZZ (synchronous and code-only: it knows nothing of an account's overrides or custom forms). */
export function getFormSchema(formId: string = DEFAULT_FORM_ID): Form {
  return FORMS[formId] ?? BIOBUZZ_FORM_SCHEMA;
}

/** Every field that holds a value (everything but the system pickers). */
export function allFields(form: Form): FormField[] {
  return valueFields(form);
}

export function defaultValuesForSchema(form: Form): FormValues {
  return defaultValues(form);
}

/**
 * The pre-v2 scoring result: the three standard subtotals and the total. (`lib/forms/scoring.ts`'s `calculateScore` also returns `byPhase`
 * for custom phases; the total here still includes them.)
 */
export function calculateScore(form: Form, values: FormValues): { auto: number; teleop: number; endgame: number; total: number } {
  const { auto, teleop, endgame, total } = scoreForm(form, values);
  return { auto, teleop, endgame, total };
}

export function valuesToScoutEntryFields(values: FormValues): ScoutEntryFields {
  return legacyFieldsFromValues(values) as unknown as ScoutEntryFields;
}

export function scoutEntryFieldsToValues(fields: ScoutEntryFields): FormValues {
  return { ...fields };
}
