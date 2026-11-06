import { findUnsafeLinks, isSafeHttpsUrl } from "@/lib/rich-text";

// Credits model and edit operations (P14). Pure — the Firestore side is store.ts.
//
// The whole page is one doc, `credits/{teamId}`, holding ordered `sections`, each
// with ordered `entries`. Every edit is expressed as a CreditsOp that
// store.ts re-applies to the *latest stored* sections inside a transaction
// (the same approach as the pick list), so two admins editing at once compose
// instead of one overwriting the other.

export type CreditEntry = {
  id: string;
  name: string;
  /** Role or description. Supports the same safe **bold** / *italic* / [link](https://…) markup as the changelog. */
  description: string;
  /** Optional https link for the whole entry. */
  link: string | null;
  /** Optional https image URL for an avatar or logo. */
  imageUrl: string | null;
};

export type CreditSection = {
  id: string;
  title: string;
  /** Position within the page. Normalised to the array index on every edit. */
  order: number;
  entries: CreditEntry[];
};

export type EntryFields = Pick<CreditEntry, "name" | "description" | "link" | "imageUrl">;

export type CreditsOp =
  | { type: "add-section"; id: string; title: string }
  | { type: "edit-section"; sectionId: string; title: string }
  | { type: "delete-section"; sectionId: string }
  | { type: "move-section"; sectionId: string; toIndex: number }
  | { type: "add-entry"; sectionId: string; entry: CreditEntry }
  | { type: "edit-entry"; sectionId: string; entryId: string; fields: EntryFields }
  | { type: "delete-entry"; sectionId: string; entryId: string }
  | { type: "move-entry"; fromSectionId: string; entryId: string; toSectionId: string; toIndex: number };

export const MAX_SECTIONS = 20;
export const MAX_ENTRIES = 60;
export const MAX_SECTION_TITLE = 80;
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 300;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Sections renumbered so `order` always equals the array position. */
export const renumber = (sections: CreditSection[]): CreditSection[] => sections.map((s, i) => ({ ...s, order: i }));

/** Moves list[from] so it ends up at index `to` (clamped), without mutating. */
function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, item);
  return next;
}

/**
 * Applies one edit to a list of sections and returns the new list. An op that
 * refers to a section or entry that no longer exists (someone else deleted it
 * first), or that would exceed a limit, changes nothing — it never throws, so a
 * stale click can't corrupt the page.
 */
export function applyCreditsOp(sections: CreditSection[], op: CreditsOp): CreditSection[] {
  const sectionIndex = (id: string) => sections.findIndex((s) => s.id === id);
  const withSection = (id: string, change: (s: CreditSection) => CreditSection): CreditSection[] => {
    const i = sectionIndex(id);
    if (i < 0) return sections;
    return sections.map((s, j) => (j === i ? change(s) : s));
  };

  switch (op.type) {
    case "add-section":
      if (sections.length >= MAX_SECTIONS || sectionIndex(op.id) >= 0) return sections;
      return renumber([...sections, { id: op.id, title: op.title, order: sections.length, entries: [] }]);

    case "edit-section":
      return withSection(op.sectionId, (s) => ({ ...s, title: op.title }));

    case "delete-section":
      return sectionIndex(op.sectionId) < 0 ? sections : renumber(sections.filter((s) => s.id !== op.sectionId));

    case "move-section": {
      const from = sectionIndex(op.sectionId);
      return from < 0 ? sections : renumber(reorder(sections, from, op.toIndex));
    }

    case "add-entry":
      return withSection(op.sectionId, (s) => (s.entries.length >= MAX_ENTRIES || s.entries.some((e) => e.id === op.entry.id) ? s : { ...s, entries: [...s.entries, op.entry] }));

    case "edit-entry":
      return withSection(op.sectionId, (s) => ({ ...s, entries: s.entries.map((e) => (e.id === op.entryId ? { ...e, ...op.fields } : e)) }));

    case "delete-entry":
      return withSection(op.sectionId, (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== op.entryId) }));

    case "move-entry": {
      const from = sectionIndex(op.fromSectionId);
      const to = sectionIndex(op.toSectionId);
      if (from < 0 || to < 0) return sections;
      const entry = sections[from].entries.find((e) => e.id === op.entryId);
      if (!entry) return sections;
      if (from === to) {
        const at = sections[from].entries.findIndex((e) => e.id === op.entryId);
        return withSection(op.fromSectionId, (s) => ({ ...s, entries: reorder(s.entries, at, op.toIndex) }));
      }
      if (sections[to].entries.length >= MAX_ENTRIES) return sections;
      return sections.map((s, j) => {
        if (j === from) return { ...s, entries: s.entries.filter((e) => e.id !== op.entryId) };
        if (j === to) {
          const entries = [...s.entries];
          entries.splice(clamp(op.toIndex, 0, entries.length), 0, entry);
          return { ...s, entries };
        }
        return s;
      });
    }
  }
}

/** True if two section lists are identical in content and order — used to skip a write (and its audit entry) when an op changed nothing. */
export const sameSections = (a: CreditSection[], b: CreditSection[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Reads stored sections defensively. Rules can't type-check list elements, so
 * anything malformed is dropped or coerced rather than crashing the page, and a
 * stored link/image that isn't https is discarded on read as a second line of
 * defence behind the editor's validation.
 */
export function sanitizeSections(raw: unknown): CreditSection[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const url = (v: unknown) => (typeof v === "string" && isSafeHttpsUrl(v) ? v : null);
  const sections: CreditSection[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object" || typeof (s as CreditSection).id !== "string") continue;
    const entries: CreditEntry[] = [];
    const rawEntries = (s as CreditSection).entries;
    for (const e of Array.isArray(rawEntries) ? rawEntries : []) {
      if (!e || typeof e !== "object" || typeof (e as CreditEntry).id !== "string") continue;
      const entry = e as CreditEntry;
      entries.push({ id: entry.id, name: str(entry.name), description: str(entry.description), link: url(entry.link), imageUrl: url(entry.imageUrl) });
    }
    sections.push({ id: (s as CreditSection).id, title: str((s as CreditSection).title), order: typeof (s as CreditSection).order === "number" ? (s as CreditSection).order : sections.length, entries });
  }
  return renumber(sections.sort((a, b) => a.order - b.order));
}

// --- validation (for the editors) ------------------------------------------------------

export type EntryErrors = Partial<Record<"name" | "description" | "link" | "imageUrl", string>>;

/** A blank optional URL is fine (null); anything else must be a safe https URL. */
export function normalizeEntryFields(f: { name: string; description: string; link: string; imageUrl: string }): EntryFields {
  return { name: f.name.trim(), description: f.description.trim(), link: f.link.trim() === "" ? null : f.link.trim(), imageUrl: f.imageUrl.trim() === "" ? null : f.imageUrl.trim() };
}

export function validateEntryFields(f: EntryFields): { ok: boolean; errors: EntryErrors } {
  const errors: EntryErrors = {};
  if (f.name === "") errors.name = "Add a name.";
  else if (f.name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters.`;

  if (f.description.length > MAX_DESCRIPTION) errors.description = `Keep it under ${MAX_DESCRIPTION} characters.`;
  else if (findUnsafeLinks(f.description).length > 0) errors.description = "Links must start with https://.";

  if (f.link !== null && !isSafeHttpsUrl(f.link)) errors.link = "Use a full link starting with https://.";
  if (f.imageUrl !== null && !isSafeHttpsUrl(f.imageUrl)) errors.imageUrl = "Use a full image link starting with https://.";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateSectionTitle(title: string): string | null {
  const t = title.trim();
  if (t === "") return "Add a section title.";
  if (t.length > MAX_SECTION_TITLE) return `Keep the title under ${MAX_SECTION_TITLE} characters.`;
  return null;
}

/** A short, human description of an op for the audit log's target. */
export function describeOp(op: CreditsOp): Record<string, unknown> {
  switch (op.type) {
    case "add-section":
      return { op: op.type, sectionId: op.id, title: op.title };
    case "edit-section":
      return { op: op.type, sectionId: op.sectionId, title: op.title };
    case "delete-section":
    case "move-section":
      return { op: op.type, sectionId: op.sectionId };
    case "add-entry":
      return { op: op.type, sectionId: op.sectionId, entryId: op.entry.id, name: op.entry.name };
    case "edit-entry":
    case "delete-entry":
      return { op: op.type, sectionId: op.sectionId, entryId: op.entryId };
    case "move-entry":
      return { op: op.type, fromSectionId: op.fromSectionId, toSectionId: op.toSectionId, entryId: op.entryId };
  }
}
