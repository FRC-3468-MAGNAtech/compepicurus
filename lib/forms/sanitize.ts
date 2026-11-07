import type { Form } from "@/lib/forms/types";

// P23: text sanitization for forms that are shared (templates, imported files). A form carries a lot of free text (names, labels, help, tips, option
// labels, CSV headers…); none of it may contain HTML, and any link in it must be https. React escapes text on render, so this isn't the only line of
// defence, but a shared form is also exported, emailed, put in a CSV and shown in other accounts, so it is cleaned at the source and again on the server.

/** A real HTML tag or comment (`<b>`, `</div>`, `<!-- -->`), not a bare "<" as in "under < 5". */
const TAG = /<\/?[a-zA-Z!][^>]*>/g;
/** `scheme://…` and the opaque schemes that run code or open apps (`javascript:`, `data:`, `mailto:`…). */
const URL_LIKE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data|vbscript|file|blob|mailto|tel|about):)\S*/gi;

export const stripHtml = (s: string): string => s.replace(TAG, "");

/** Links in `s` that aren't https. */
export function nonHttpsLinks(s: string): string[] {
  return (s.match(URL_LIKE) ?? []).filter((u) => !/^https:\/\//i.test(u));
}

export type TextSlot = { path: string; value: string };

/** Every free-text string a form carries, with where it lives (for error messages). */
export function textSlots(form: Form): TextSlot[] {
  const out: TextSlot[] = [
    { path: "name", value: form.name },
    { path: "description", value: form.description },
    ...form.tags.map((t, i) => ({ path: `tags[${i}]`, value: t })),
    ...Object.entries(form.phaseLabels ?? {}).map(([k, v]) => ({ path: `phaseLabels.${k}`, value: v })),
  ];
  for (const s of form.sections) {
    out.push({ path: `category "${s.title}" title`, value: s.title });
    for (const g of s.groups ?? []) out.push({ path: `group "${g.title}" title`, value: g.title });
    for (const f of s.fields) {
      const at = `field "${f.label}"`;
      out.push({ path: `${at} label`, value: f.label });
      for (const k of ["helpText", "tip", "placeholder"] as const) if (typeof f[k] === "string") out.push({ path: `${at} ${k}`, value: f[k] as string });
      if (typeof f.default === "string") out.push({ path: `${at} default`, value: f.default });
      for (const o of f.options ?? []) out.push({ path: `${at} option "${o.label}"`, value: o.label });
      for (const k of ["label", "category", "csvHeader", "element"] as const) if (typeof f.analytics?.[k] === "string") out.push({ path: `${at} analytics ${k}`, value: f.analytics[k] as string });
    }
  }
  return out;
}

/** Applies `fn` to every free-text string, returning a new form (same slots as `textSlots`). */
export function mapFormText(form: Form, fn: (s: string) => string): Form {
  const opt = (s: string | undefined) => (typeof s === "string" ? fn(s) : s);
  const clean = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return {
    ...form,
    name: fn(form.name),
    description: fn(form.description),
    tags: form.tags.map(fn),
    ...(form.phaseLabels ? { phaseLabels: Object.fromEntries(Object.entries(form.phaseLabels).map(([k, v]) => [k, fn(v)])) } : {}),
    sections: form.sections.map((s) => ({
      ...s,
      title: fn(s.title),
      ...(s.groups ? { groups: s.groups.map((g) => ({ ...g, title: fn(g.title) })) } : {}),
      fields: s.fields.map((f) =>
        clean({
          ...f,
          label: fn(f.label),
          helpText: opt(f.helpText),
          tip: opt(f.tip),
          placeholder: opt(f.placeholder),
          default: typeof f.default === "string" ? fn(f.default) : f.default,
          options: f.options?.map((o) => ({ ...o, label: fn(o.label) })),
          analytics: f.analytics ? clean({ ...f.analytics, label: opt(f.analytics.label), category: opt(f.analytics.category), csvHeader: opt(f.analytics.csvHeader), element: opt(f.analytics.element) }) : undefined,
        }) as typeof f
      ),
    })),
  };
}

export type SanitizeResult = {
  form: Form;
  /** How many strings had HTML removed. */
  stripped: number;
  /** Strings with a link that isn't https (these are refused, not rewritten). */
  problems: string[];
};

/** Strips HTML from every text and reports non-https links. The returned form is what to store; `problems` non-empty means the form must not be shared as is. */
export function sanitizeFormText(form: Form): SanitizeResult {
  let stripped = 0;
  const cleaned = mapFormText(form, (s) => {
    const next = stripHtml(s);
    if (next !== s) stripped++;
    return next;
  });
  const problems = textSlots(cleaned)
    .filter((t) => nonHttpsLinks(t.value).length > 0)
    .map((t) => `${t.path} has a link that isn't https (${nonHttpsLinks(t.value)[0].slice(0, 40)})`);
  return { form: cleaned, stripped, problems };
}
