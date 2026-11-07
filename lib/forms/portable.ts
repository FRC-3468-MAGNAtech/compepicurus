import type { Form } from "@/lib/forms/types";
import { FORM_LIMITS, checkForm, parseForm, type FormIssue, type ParseIssue } from "@/lib/forms/validate";
import { contentHash } from "@/lib/forms/hash";
import { repairDuplicates } from "@/lib/forms/edit";
import { sanitizeFormText } from "@/lib/forms/sanitize";

// P21: `exportForm` / `importForm`: the portable JSON form of a Form, for sharing between accounts and for the template
// library (P23). Pure and strict: an import is size-limited, parsed as untrusted data, validated against schema v2
// (unknown keys, unknown field types and over-long or control-character text are all rejected), sanitized, checked for
// semantic problems, and never allowed to claim to be a built-in or to carry someone else's provenance.

export const FORM_EXPORT_FORMAT = "compepicurus-form";
export const FORM_EXPORT_VERSION = 1;

/** `checksum` is a content hash of `form` (P23): it notices a damaged or hand-edited file (a warning, not a refusal). It is not a signature: anyone can recompute it. */
export type FormExport = { format: typeof FORM_EXPORT_FORMAT; formatVersion: number; checksum?: string; form: Form };

/** The form with everything instance-specific removed (who made it, when, its status, where it came from), so what is shared is only what defines the form. */
export function exportForm(form: Form): FormExport {
  const portable: Form = {
    ...form,
    status: "draft",
    version: 0,
    origin: "custom",
    createdBy: "",
  };
  delete portable.createdAt;
  delete portable.updatedAt;
  delete portable.baseBuiltInId;
  delete portable.baseBuiltInHash;
  delete portable.templateId;
  delete portable.templateVersion;
  return { format: FORM_EXPORT_FORMAT, formatVersion: FORM_EXPORT_VERSION, checksum: contentHash(portable), form: portable };
}

/** The checksum of a form as exported (what `exportForm(form).checksum` is). */
export const formChecksum = (form: Form): string => exportForm(form).checksum as string;

export const exportFormJson = (form: Form): string => JSON.stringify(exportForm(form), null, 2);

export type ImportOptions = {
  /** Fix duplicate ids and keys (the later duplicate is renamed) instead of refusing the file. */
  repairDuplicates?: boolean;
};

export type ImportResult =
  | { ok: true; form: Form; warnings: FormIssue[]; /** What was fixed or removed on the way in. */ changes: string[] }
  | { ok: false; errors: string[]; issues: (ParseIssue | FormIssue)[] };

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Collapses whitespace in every short label so a pasted form can't carry layout tricks (newlines, runs of spaces) into the UI. */
function sanitizeForm(form: Form): Form {
  return {
    ...form,
    name: collapse(form.name),
    description: form.description.trim(),
    tags: [...new Set(form.tags.map(collapse).filter(Boolean))],
    sections: form.sections.map((s) => ({
      ...s,
      title: collapse(s.title),
      groups: s.groups?.map((g) => ({ ...g, title: collapse(g.title) })),
      fields: s.fields.map((f) => ({
        ...f,
        label: collapse(f.label),
        options: f.options?.map((o) => ({ ...o, label: collapse(o.label) })),
      })),
    })),
  };
}

/**
 * Parses and validates a form export. `input` is the JSON text (or an already-parsed object, e.g. a template document). On success
 * the form is returned as an unpublished **custom** draft (`version: 0`, no author, no dates): the caller assigns its id, owner and
 * account. Anything wrong comes back as readable errors; nothing is partially accepted.
 */
export function importForm(input: unknown, options: ImportOptions = {}): ImportResult {
  let data: unknown = input;
  if (typeof input === "string") {
    if (input.length > FORM_LIMITS.jsonBytes) return { ok: false, errors: [`That file is too large (the limit is ${Math.round(FORM_LIMITS.jsonBytes / 1024)} KB).`], issues: [] };
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["That isn't valid JSON."], issues: [] };
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["That isn't a form export."], issues: [] };
  const envelope = data as Record<string, unknown>;
  if (envelope.format !== FORM_EXPORT_FORMAT) return { ok: false, errors: ["That file isn't a CompEpicurus form export."], issues: [] };
  if (envelope.formatVersion !== FORM_EXPORT_VERSION) {
    return { ok: false, errors: [`This export uses format version ${String(envelope.formatVersion)}, which this app can't read (it reads version ${FORM_EXPORT_VERSION}).`], issues: [] };
  }

  const parsed = parseForm(envelope.form);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.issues.slice(0, 8).map((i) => `${i.path || "form"}: ${i.message}`), issues: parsed.issues };
  }

  const changes: string[] = [];
  let working = parsed.form;
  // HTML never survives an import; a link that isn't https is refused (the author can fix the text, we don't guess).
  const scrubbed = sanitizeFormText(working);
  working = scrubbed.form;
  if (scrubbed.stripped > 0) changes.push(`HTML was removed from ${scrubbed.stripped} text${scrubbed.stripped === 1 ? "" : "s"}.`);
  if (scrubbed.problems.length > 0) return { ok: false, errors: scrubbed.problems.slice(0, 8), issues: [] };
  if (options.repairDuplicates) {
    const fixed = repairDuplicates(working);
    working = fixed.form;
    changes.push(...fixed.fixes);
  }
  const form = sanitizeForm(working);
  const issues = checkForm(form);
  if (typeof envelope.checksum === "string" && envelope.checksum !== contentHash(envelope.form)) {
    issues.push({ severity: "warning", code: "checksum-mismatch", message: "This file's checksum doesn't match its contents: it was edited or damaged since it was exported. It passed every check below, but only import it if you trust where it came from." });
  }
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 8).map((i) => i.message), issues };

  const clean: Form = { ...form, status: "draft", version: 0, origin: "custom", createdBy: "" };
  delete clean.createdAt;
  delete clean.updatedAt;
  delete clean.baseBuiltInId;
  delete clean.baseBuiltInHash;
  delete clean.templateId;
  delete clean.templateVersion;
  return { ok: true, form: clean, warnings: issues.filter((i) => i.severity === "warning"), changes };
}
