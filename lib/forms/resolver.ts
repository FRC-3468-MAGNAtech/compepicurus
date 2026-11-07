import type { ScoutEntry } from "@/lib/scout-entries";
import { getBuiltinForm } from "@/lib/forms/builtin";
import type { Form } from "@/lib/forms/types";

/**
 * P21: which form to read an entry against. Rescoring and recompute pass the account's **current** form for the entry's `formId` (the latest
 * published version, so "I changed the scoring: rescore" does what it says); the default is the built-in with that id.
 */
export type FormResolver = (entry: Pick<ScoutEntry, "formId" | "formVersion">) => Form | null;

export const builtinFormResolver: FormResolver = (entry) => getBuiltinForm(entry.formId);
