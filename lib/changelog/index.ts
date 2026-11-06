import { findUnsafeLinks, richTextToPlain } from "@/lib/rich-text";

// Changelog model and pure logic (P14). The Firestore side is store.ts; the
// starter drafts are seed.ts. Nothing here touches Firebase, so all of it is
// unit tested.

export type ChangeType = "new" | "improved" | "fixed" | "removed";

/** The four kinds of change, in display order, each with a colour-coded pill and bullet. */
export const CHANGE_TYPES: { id: ChangeType; label: string; pill: string; bullet: string }[] = [
  { id: "new", label: "New", pill: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30", bullet: "bg-emerald-400" },
  { id: "improved", label: "Improved", pill: "bg-sky-500/15 text-sky-300 border border-sky-400/30", bullet: "bg-sky-400" },
  { id: "fixed", label: "Fixed", pill: "bg-amber-500/15 text-amber-300 border border-amber-400/30", bullet: "bg-amber-400" },
  { id: "removed", label: "Removed", pill: "bg-red-500/15 text-red-300 border border-red-400/30", bullet: "bg-red-400" },
];

export const CHANGE_TYPE_IDS = CHANGE_TYPES.map((t) => t.id);
export const isChangeType = (v: unknown): v is ChangeType => typeof v === "string" && (CHANGE_TYPE_IDS as string[]).includes(v);

export type ChangeItem = { type: ChangeType; text: string };
export type ChangelogStatus = "draft" | "published";

export type ChangelogEntry = {
  id: string;
  teamId: string;
  /** "v1.4.0" or any date label. */
  version: string;
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  summary: string;
  changes: ChangeItem[];
  status: ChangelogStatus;
  pinned: boolean;
  createdBy: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  /** When it first went live (drives the unread dot). Null for drafts, and briefly for an entry whose server timestamp hasn't resolved yet. */
  publishedAtMs: number | null;
};

/** What the editor edits. */
export type ChangelogDraft = {
  version: string;
  title: string;
  date: string;
  summary: string;
  changes: ChangeItem[];
  status: ChangelogStatus;
  pinned: boolean;
};

// Limits — kept modest on purpose; firestore.rules enforces the same ones (as far as rules can).
export const MAX_VERSION = 40;
export const MAX_TITLE = 120;
export const MAX_SUMMARY = 1000;
export const MAX_CHANGE_TEXT = 400;
export const MAX_CHANGES = 40;

// --- reading stored docs --------------------------------------------------------------

/** A Firestore Timestamp (or anything with `toMillis`) as milliseconds; null while a server timestamp is still pending or absent. */
export function timestampMs(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * A stored `changelog/{id}` doc as a ChangelogEntry. Defensive about shape —
 * rules can't type-check every list element, so a malformed change row is
 * dropped rather than crashing the page.
 */
export function entryFromData(id: string, data: Record<string, unknown>): ChangelogEntry {
  const rawChanges = Array.isArray(data.changes) ? data.changes : [];
  const changes: ChangeItem[] = [];
  for (const c of rawChanges) {
    if (c && typeof c === "object" && isChangeType((c as ChangeItem).type) && typeof (c as ChangeItem).text === "string") {
      changes.push({ type: (c as ChangeItem).type, text: (c as ChangeItem).text });
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id,
    teamId: str(data.teamId),
    version: str(data.version),
    title: str(data.title),
    date: str(data.date),
    summary: str(data.summary),
    changes,
    status: data.status === "published" ? "published" : "draft",
    pinned: data.pinned === true,
    createdBy: str(data.createdBy),
    createdAtMs: timestampMs(data.createdAt),
    updatedAtMs: timestampMs(data.updatedAt),
    publishedAtMs: timestampMs(data.publishedAt),
  };
}

// --- ordering, filtering, grouping ------------------------------------------------

/** Pinned first; then newest date; ties by when it was published/created, then version. */
export function compareEntries(a: ChangelogEntry, b: ChangelogEntry): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  const at = a.publishedAtMs ?? a.createdAtMs ?? 0;
  const bt = b.publishedAtMs ?? b.createdAtMs ?? 0;
  if (at !== bt) return bt - at;
  return b.version.localeCompare(a.version, undefined, { numeric: true });
}

export const sortEntries = (entries: ChangelogEntry[]): ChangelogEntry[] => [...entries].sort(compareEntries);

export type ChangelogFilter = { types: ChangeType[]; query: string };

/** The changes to show for a filter: all of them, or only the selected types. */
export function visibleChanges(entry: Pick<ChangelogEntry, "changes">, types: ChangeType[]): ChangeItem[] {
  return types.length === 0 ? entry.changes : entry.changes.filter((c) => types.includes(c.type));
}

/**
 * Does the entry belong in the filtered list? With types selected it needs at
 * least one change of those types; the search matches version, title, summary,
 * and change text with the markup stripped (so searching "docs" finds
 * `[the docs](…)`).
 */
export function entryMatches(entry: ChangelogEntry, filter: ChangelogFilter): boolean {
  if (filter.types.length > 0 && visibleChanges(entry, filter.types).length === 0) return false;
  const q = filter.query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [entry.version, entry.title, richTextToPlain(entry.summary), ...entry.changes.map((c) => richTextToPlain(c.text))].join("\n").toLowerCase();
  return haystack.includes(q);
}

export function filterEntries(entries: ChangelogEntry[], filter: ChangelogFilter): ChangelogEntry[] {
  return entries.filter((e) => entryMatches(e, filter));
}

/** Changes grouped by type in display order (New, Improved, Fixed, Removed), skipping empty groups. */
export function groupChanges(changes: ChangeItem[]): { type: ChangeType; items: ChangeItem[] }[] {
  return CHANGE_TYPE_IDS.map((type) => ({ type, items: changes.filter((c) => c.type === type) })).filter((g) => g.items.length > 0);
}

/** How many entries have at least one change of each type (for the filter chips). */
export function countByType(entries: ChangelogEntry[]): Record<ChangeType, number> {
  const counts: Record<ChangeType, number> = { new: 0, improved: 0, fixed: 0, removed: 0 };
  for (const e of entries) for (const t of new Set(e.changes.map((c) => c.type))) counts[t] += 1;
  return counts;
}

/** The ids that start expanded: the first `count` (newest) of the displayed list; everything else collapses. */
export function initiallyExpanded(displayed: ChangelogEntry[], count: number = 2): Set<string> {
  return new Set(displayed.slice(0, count).map((e) => e.id));
}

// --- unread dot --------------------------------------------------------------------

/**
 * Whether any *published* entry went live after the user last opened the
 * changelog. `lastSeenMs` null = never opened. An entry whose publish time is
 * still pending (the admin's own just-published write) doesn't count — they
 * made it.
 */
export function hasUnread(entries: Pick<ChangelogEntry, "status" | "publishedAtMs">[], lastSeenMs: number | null): boolean {
  const seen = lastSeenMs ?? 0;
  return entries.some((e) => e.status === "published" && e.publishedAtMs !== null && e.publishedAtMs > seen);
}

export function latestPublishedMs(entries: Pick<ChangelogEntry, "status" | "publishedAtMs">[]): number | null {
  const times = entries.filter((e) => e.status === "published" && e.publishedAtMs !== null).map((e) => e.publishedAtMs!);
  return times.length === 0 ? null : Math.max(...times);
}

// --- editing -------------------------------------------------------------------------

export const entryLabel = (e: Pick<ChangelogEntry, "version" | "title">): string => `${e.version} — ${e.title}`;

export function emptyDraft(todayIso: string): ChangelogDraft {
  return { version: "", title: "", date: todayIso, summary: "", changes: [{ type: "new", text: "" }], status: "draft", pinned: false };
}

export function entryToDraft(e: ChangelogEntry): ChangelogDraft {
  return { version: e.version, title: e.title, date: e.date, summary: e.summary, changes: e.changes.map((c) => ({ ...c })), status: e.status, pinned: e.pinned };
}

/** Trims text and drops empty change rows — what actually gets saved. */
export function normalizeDraft(d: ChangelogDraft): ChangelogDraft {
  return {
    ...d,
    version: d.version.trim(),
    title: d.title.trim(),
    summary: d.summary.trim(),
    changes: d.changes.map((c) => ({ type: c.type, text: c.text.trim() })).filter((c) => c.text !== ""),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A Date as the YYYY-MM-DD of the *local* calendar day — what the editor's date field defaults to. */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Nov 5, 2026" for a YYYY-MM-DD — formatted in UTC so the day never shifts with the viewer's timezone. Falls back to the raw text for anything invalid. */
export function formatEntryDate(iso: string): string {
  if (!isValidIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export type DraftErrors = Partial<Record<"version" | "title" | "date" | "summary" | "changes", string>> & { changeRows?: Record<number, string> };

/**
 * Validates a draft (before normalizing, so row numbers match what the editor
 * shows). Links in any text must be https — a `[label](url)` with another
 * scheme would render as inert text, so it's flagged instead of silently saved.
 */
export function validateDraft(d: ChangelogDraft): { ok: boolean; errors: DraftErrors } {
  const errors: DraftErrors = {};
  if (d.version.trim() === "") errors.version = "Add a version or date label, like v1.4.0.";
  else if (d.version.trim().length > MAX_VERSION) errors.version = `Keep it under ${MAX_VERSION} characters.`;

  if (d.title.trim() === "") errors.title = "Add a title.";
  else if (d.title.trim().length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters.`;

  if (!isValidIsoDate(d.date)) errors.date = "Pick a valid date.";

  if (d.summary.trim().length > MAX_SUMMARY) errors.summary = `Keep the summary under ${MAX_SUMMARY} characters.`;
  else if (findUnsafeLinks(d.summary).length > 0) errors.summary = "Links must start with https://.";

  const rows = d.changes.map((c, i) => ({ c, i })).filter(({ c }) => c.text.trim() !== "");
  const rowErrors: Record<number, string> = {};
  for (const { c, i } of rows) {
    if (!isChangeType(c.type)) rowErrors[i] = "Pick a change type.";
    else if (c.text.trim().length > MAX_CHANGE_TEXT) rowErrors[i] = `Keep each change under ${MAX_CHANGE_TEXT} characters.`;
    else if (findUnsafeLinks(c.text).length > 0) rowErrors[i] = "Links must start with https://.";
  }
  if (Object.keys(rowErrors).length > 0) errors.changeRows = rowErrors;
  if (rows.length === 0) errors.changes = "Add at least one change.";
  else if (rows.length > MAX_CHANGES) errors.changes = `At most ${MAX_CHANGES} changes per entry.`;

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Moves list[index] up (-1) or down (+1) by one; returns the same order at the ends. Never mutates. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
