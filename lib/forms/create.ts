import type { Form } from "@/lib/forms/types";
import { createBlankForm, slugifyFormId } from "@/lib/forms/new-form";
import { importForm } from "@/lib/forms/portable";
import { FORM_LIMITS } from "@/lib/forms/validate";

// P22: the three ways to start a new form from the Forms list (from scratch, duplicate an existing one, import a file), as pure functions that
// return the unpublished draft to save. Each one gets a fresh, unique id and the author as owner, and is always a **custom** form: a copy of a
// built-in is never an "override" (it would otherwise replace the built-in for scouts).

type Common = { name: string; taken: ReadonlySet<string>; createdBy: string; now?: number };

const clampName = (name: string, fallback: string): string => (name.trim() || fallback).slice(0, FORM_LIMITS.name);

export function newFormFromScratch(input: Common & { description?: string }): Form {
  const name = clampName(input.name, "Untitled form");
  const form = createBlankForm({ id: slugifyFormId(name, input.taken), name, createdBy: input.createdBy, description: input.description, now: input.now });
  return form;
}

/** A copy of `source` as a new custom form (its fields keep their ids and keys: ids only need to be unique within a form). */
export function duplicateAsNewForm(source: Form, input: Common): Form {
  const name = clampName(input.name, `${source.name} (copy)`);
  const copy: Form = {
    ...(JSON.parse(JSON.stringify(source)) as Form),
    id: slugifyFormId(name, input.taken),
    name,
    version: 0,
    status: "draft",
    origin: "custom",
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  };
  delete copy.baseBuiltInId;
  delete copy.baseBuiltInHash;
  delete copy.templateId;
  delete copy.templateVersion;
  // Tags are kept on purpose: a copy of a season's form is for that season, so its entries count in that season's analytics (lib/forms/forms-context.tsx useGameFormIds).
  return copy;
}

/** The result of importing a form file for the list: the draft to save, or readable errors. */
export type ImportedDraft = { ok: true; form: Form; warnings: string[] } | { ok: false; errors: string[] };

export function formFromImport(text: string, input: Common): ImportedDraft {
  const r = importForm(text);
  if (!r.ok) return { ok: false, errors: r.errors };
  const name = clampName(input.name, r.form.name);
  return {
    ok: true,
    form: { ...r.form, id: slugifyFormId(name, input.taken), name, createdBy: input.createdBy, createdAt: input.now, updatedAt: input.now },
    warnings: r.warnings.map((w) => w.message),
  };
}
