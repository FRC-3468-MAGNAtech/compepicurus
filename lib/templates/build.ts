import type { Form } from "@/lib/forms/types";
import { exportForm, formChecksum } from "@/lib/forms/portable";
import { sanitizeFormText, stripHtml, nonHttpsLinks } from "@/lib/forms/sanitize";
import { slugifyFormId } from "@/lib/forms/new-form";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";

// P23: form templates as pure data and functions: what a template document is, how one is built from a form (validated, sanitized, size-limited), how a
// form is made from one, and how the library lists, filters and sorts them. The Firestore store, the server route and the UI all use these, so a
// template means the same thing everywhere.

export type TemplateVisibility = "private" | "public-pending" | "public" | "rejected";

export const TEMPLATE_LIMITS = {
  /** The form snapshot as JSON. */
  jsonBytes: 256 * 1024,
  name: 80,
  description: 500,
  tags: 10,
  tagLength: 30,
  authorName: 80,
  reason: 300,
  /** Publish requests (and updates to a public template) per account per hour. */
  requestsPerHour: 3,
  /** Requests waiting for review per account. */
  pendingPerAccount: 5,
} as const;

/** `formTemplates/{id}`. Times are epoch milliseconds. */
export type FormTemplate = {
  id: string;
  visibility: TemplateVisibility;
  ownerTeamId: string;
  authorName: string;
  /** Published by the platform owner as one of ours. Only the platform owner can set it. */
  official: boolean;
  name: string;
  description: string;
  tags: string[];
  /** Starts at 1; "update from the current form" adds one. */
  version: number;
  /** The schema snapshot (see `exportForm`: nothing instance-specific). */
  form: Form;
  checksum: string;
  fieldCount: number;
  sectionCount: number;
  /** Accounts that used it (counted by the server, once per account). */
  importCount: number;
  reportCount: number;
  /** A public template's author sent a new version that is waiting for review (the approved version stays live meanwhile). */
  hasPendingUpdate?: boolean;
  rejectionReason?: string;
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
  requestedAt?: number;
};

export type TemplateContent = Pick<FormTemplate, "name" | "description" | "tags" | "form" | "checksum" | "fieldCount" | "sectionCount">;

export type BuildResult = { ok: true; content: TemplateContent; notes: string[] } | { ok: false; errors: string[] };

const clamp = (s: string, n: number): string => s.replace(/\s+/g, " ").trim().slice(0, n);

export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => clamp(stripHtml(t), TEMPLATE_LIMITS.tagLength).toLowerCase()).filter(Boolean))].slice(0, TEMPLATE_LIMITS.tags);
}

export const countFields = (form: Pick<Form, "sections">): number => form.sections.reduce((n, s) => n + s.fields.length, 0);

/**
 * A template's content from a form and the author's words: the portable snapshot (no author, dates or provenance), every text stripped of HTML, links
 * required to be https, the form validated (strict parse and no blocking problems) and size-checked. This is what is stored for a private template and
 * what the server re-runs before anything becomes public.
 */
export function buildTemplateContent(input: { form: Form; name: string; description?: string; tags?: readonly string[] }): BuildResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const name = clamp(stripHtml(input.name), TEMPLATE_LIMITS.name);
  const description = stripHtml(input.description ?? "").trim().slice(0, TEMPLATE_LIMITS.description);
  if (!name) errors.push("Give the template a name.");
  for (const [label, text] of [["name", input.name], ["description", input.description ?? ""]] as const) {
    const bad = nonHttpsLinks(text);
    if (bad.length > 0) errors.push(`The ${label} has a link that isn't https.`);
  }

  const portable = exportForm(input.form).form;
  const parsed = parseForm(portable);
  if (!parsed.ok) return { ok: false, errors: [...errors, `This form isn't valid: ${parsed.issues[0]?.message ?? "unknown problem"}.`] };
  const scrubbed = sanitizeFormText(parsed.form);
  if (scrubbed.stripped > 0) notes.push(`HTML was removed from ${scrubbed.stripped} text${scrubbed.stripped === 1 ? "" : "s"}.`);
  errors.push(...scrubbed.problems);
  const blocking = blockingIssues(checkForm(scrubbed.form));
  if (blocking.length > 0) errors.push(`Fix ${blocking.length} problem${blocking.length === 1 ? "" : "s"} in the form first: ${blocking[0].message}`);
  const form = scrubbed.form;
  if (JSON.stringify(form).length > TEMPLATE_LIMITS.jsonBytes) errors.push(`The form is too large for a template (the limit is ${Math.round(TEMPLATE_LIMITS.jsonBytes / 1024)} KB).`);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, notes, content: { name, description, tags: cleanTags(input.tags ?? []), form, checksum: formChecksum(form), fieldCount: countFields(form), sectionCount: form.sections.length } };
}

/** The checksum a template's stored form should have: a stored mismatch means the doc was tampered with or damaged. */
export const checksumMatches = (t: Pick<FormTemplate, "form" | "checksum">): boolean => formChecksum(t.form) === t.checksum;

/**
 * A new draft form from a template: a copy, recorded as coming from `templateId` at `templateVersion` (so an update can be offered later), always an
 * unpublished draft with a unique id and the user as author. Tags are kept (a copy of a season's form is for that season).
 */
export function formFromTemplate(template: Pick<FormTemplate, "id" | "version" | "form" | "name">, input: { name?: string; taken: ReadonlySet<string>; createdBy: string; now?: number }): Form {
  const name = clamp(input.name ?? template.name, 80) || template.name;
  const copy = JSON.parse(JSON.stringify(template.form)) as Form;
  delete copy.baseBuiltInId;
  delete copy.baseBuiltInHash;
  return {
    ...copy,
    id: slugifyFormId(name, input.taken),
    name,
    version: 0,
    status: "draft",
    origin: "template",
    templateId: template.id,
    templateVersion: template.version,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** A form made from a template can be offered an update when the template (still readable by the account) has a newer version. */
export function updateAvailable(form: Pick<Form, "templateId" | "templateVersion">, template: Pick<FormTemplate, "id" | "version"> | null | undefined): boolean {
  return !!form.templateId && !!template && template.id === form.templateId && template.version > (form.templateVersion ?? 0);
}

// --- the library's search, tags and sorting ------------------------------------------------------------------------------------------

export type TemplateSort = "newest" | "popular";

export type TemplateQuery = { q?: string; tag?: string | null; sort?: TemplateSort; officialOnly?: boolean };

const when = (t: FormTemplate): number => t.publishedAt ?? t.updatedAt ?? t.createdAt ?? 0;

export function filterTemplates(list: readonly FormTemplate[], query: TemplateQuery = {}): FormTemplate[] {
  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out = list.filter((t) => {
    if (query.officialOnly && !t.official) return false;
    if (query.tag && !t.tags.includes(query.tag)) return false;
    if (terms.length === 0) return true;
    const hay = `${t.name} ${t.description} ${t.tags.join(" ")} ${t.authorName}`.toLowerCase();
    return terms.every((w) => hay.includes(w));
  });
  const sort = query.sort ?? "newest";
  return [...out].sort((a, b) => (sort === "popular" ? b.importCount - a.importCount || when(b) - when(a) : when(b) - when(a)) || a.name.localeCompare(b.name));
}

/** The tags in use, most common first, for the filter chips. */
export function templateTags(list: readonly FormTemplate[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of list) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
