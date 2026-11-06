import { describe, expect, it } from "vitest";
import {
  CHANGE_TYPES,
  MAX_CHANGES,
  MAX_CHANGE_TEXT,
  MAX_TITLE,
  compareEntries,
  countByType,
  emptyDraft,
  entryFromData,
  entryMatches,
  formatEntryDate,
  localIsoDate,
  timestampMs,
  entryToDraft,
  filterEntries,
  groupChanges,
  hasUnread,
  initiallyExpanded,
  isValidIsoDate,
  latestPublishedMs,
  moveItem,
  normalizeDraft,
  sortEntries,
  validateDraft,
  visibleChanges,
  type ChangelogDraft,
  type ChangelogEntry,
} from "./index";
import { STARTER_ENTRIES, starterDocId } from "./seed";

function entry(over: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    id: "e1",
    teamId: "t",
    version: "v1.0.0",
    title: "Title",
    date: "2026-01-10",
    summary: "",
    changes: [{ type: "new", text: "Something" }],
    status: "published",
    pinned: false,
    createdBy: "u",
    createdAtMs: 1,
    updatedAtMs: 1,
    publishedAtMs: 1,
    ...over,
  };
}

describe("sortEntries", () => {
  it("puts pinned first, then newest date first", () => {
    const sorted = sortEntries([entry({ id: "old", date: "2026-01-01" }), entry({ id: "pinned-old", date: "2025-06-01", pinned: true }), entry({ id: "new", date: "2026-03-01" })]);
    expect(sorted.map((e) => e.id)).toEqual(["pinned-old", "new", "old"]);
  });

  it("breaks same-day ties by publish time, then version (numerically)", () => {
    const a = entry({ id: "a", date: "2026-01-01", publishedAtMs: 100, version: "v1.2.0" });
    const b = entry({ id: "b", date: "2026-01-01", publishedAtMs: 200, version: "v1.1.0" });
    expect(sortEntries([a, b]).map((e) => e.id)).toEqual(["b", "a"]);
    const c = entry({ id: "c", date: "2026-01-01", publishedAtMs: 100, version: "v1.10.0" });
    const d = entry({ id: "d", date: "2026-01-01", publishedAtMs: 100, version: "v1.9.0" });
    expect(sortEntries([d, c]).map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("does not mutate its input", () => {
    const list = [entry({ id: "a", date: "2026-01-01" }), entry({ id: "b", date: "2026-02-01" })];
    sortEntries(list);
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
    expect(compareEntries(list[0], list[1])).toBeGreaterThan(0);
  });
});

describe("filtering", () => {
  const e1 = entry({ id: "1", version: "v2.0.0", title: "Big release", summary: "Read the [docs](https://example.com)", changes: [{ type: "new", text: "A shiny **feature**" }, { type: "fixed", text: "A nasty bug" }] });
  const e2 = entry({ id: "2", title: "Cleanup", changes: [{ type: "removed", text: "Old page" }] });

  it("keeps only entries with a change of a selected type, and shows only those changes", () => {
    expect(filterEntries([e1, e2], { types: ["fixed"], query: "" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterEntries([e1, e2], { types: ["fixed", "removed"], query: "" }).map((e) => e.id)).toEqual(["1", "2"]);
    expect(visibleChanges(e1, ["fixed"])).toEqual([{ type: "fixed", text: "A nasty bug" }]);
    expect(visibleChanges(e1, [])).toHaveLength(2);
  });

  it("searches version, title, summary, and change text, ignoring markup and case", () => {
    expect(entryMatches(e1, { types: [], query: "V2.0" })).toBe(true);
    expect(entryMatches(e1, { types: [], query: "big RELEASE" })).toBe(true);
    expect(entryMatches(e1, { types: [], query: "docs" })).toBe(true); // inside [docs](…)
    expect(entryMatches(e1, { types: [], query: "https://example.com" })).toBe(false); // the URL isn't searchable text
    expect(entryMatches(e1, { types: [], query: "shiny feature" })).toBe(true); // **feature** markup stripped
    expect(entryMatches(e1, { types: [], query: "nonsense" })).toBe(false);
  });

  it("combines type and search", () => {
    expect(entryMatches(e1, { types: ["removed"], query: "shiny" })).toBe(false);
    expect(entryMatches(e1, { types: ["new"], query: "shiny" })).toBe(true);
  });

  it("counts entries per change type", () => {
    expect(countByType([e1, e2])).toEqual({ new: 1, improved: 0, fixed: 1, removed: 1 });
  });
});

describe("groupChanges / initiallyExpanded", () => {
  it("groups in New, Improved, Fixed, Removed order and drops empty groups", () => {
    const groups = groupChanges([
      { type: "removed", text: "r" },
      { type: "new", text: "n1" },
      { type: "fixed", text: "f" },
      { type: "new", text: "n2" },
    ]);
    expect(groups.map((g) => g.type)).toEqual(["new", "fixed", "removed"]);
    expect(groups[0].items.map((i) => i.text)).toEqual(["n1", "n2"]);
    expect(CHANGE_TYPES.map((t) => t.id)).toEqual(["new", "improved", "fixed", "removed"]);
  });

  it("starts the newest two expanded", () => {
    const list = [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })];
    expect([...initiallyExpanded(list)]).toEqual(["a", "b"]);
    expect([...initiallyExpanded(list.slice(0, 1))]).toEqual(["a"]);
    expect([...initiallyExpanded([])]).toEqual([]);
  });
});

describe("unread dot", () => {
  const pub = (ms: number | null) => ({ status: "published" as const, publishedAtMs: ms });

  it("is unread when a published entry went live after the last visit", () => {
    expect(hasUnread([pub(2000)], 1000)).toBe(true);
    expect(hasUnread([pub(1000)], 1000)).toBe(false);
    expect(hasUnread([pub(500)], 1000)).toBe(false);
  });

  it("everything published is unread before the first visit", () => {
    expect(hasUnread([pub(1)], null)).toBe(true);
    expect(hasUnread([], null)).toBe(false);
  });

  it("ignores drafts and entries whose publish time is still pending", () => {
    expect(hasUnread([{ status: "draft", publishedAtMs: 9999 }], 0)).toBe(false);
    expect(hasUnread([pub(null)], 0)).toBe(false);
  });

  it("an edit to an already-seen entry does not bring the dot back (only publishing does)", () => {
    // publishedAtMs doesn't move on edits, so an entry seen at 1000 stays seen.
    expect(hasUnread([{ status: "published", publishedAtMs: 800 }], 1000)).toBe(false);
  });

  it("finds the latest published time", () => {
    expect(latestPublishedMs([pub(5), pub(9), pub(null), { status: "draft", publishedAtMs: 99 }])).toBe(9);
    expect(latestPublishedMs([])).toBeNull();
  });
});

describe("draft validation", () => {
  const ok = (over: Partial<ChangelogDraft> = {}): ChangelogDraft => ({ version: "v1.0.0", title: "Hello", date: "2026-01-10", summary: "", changes: [{ type: "new", text: "x" }], status: "draft", pinned: false, ...over });

  it("accepts a complete draft", () => {
    expect(validateDraft(ok())).toEqual({ ok: true, errors: {} });
  });

  it("requires a version, a title, a real date, and at least one change", () => {
    const { errors } = validateDraft(ok({ version: " ", title: "", date: "2026-02-30", changes: [{ type: "new", text: "   " }] }));
    expect(errors.version).toBeTruthy();
    expect(errors.title).toBeTruthy();
    expect(errors.date).toBeTruthy();
    expect(errors.changes).toBeTruthy();
  });

  it("enforces the length limits", () => {
    expect(validateDraft(ok({ title: "x".repeat(MAX_TITLE + 1) })).errors.title).toBeTruthy();
    expect(validateDraft(ok({ changes: [{ type: "new", text: "x".repeat(MAX_CHANGE_TEXT + 1) }] })).errors.changeRows?.[0]).toBeTruthy();
    expect(validateDraft(ok({ changes: Array.from({ length: MAX_CHANGES + 1 }, () => ({ type: "new" as const, text: "x" })) })).errors.changes).toBeTruthy();
  });

  it("flags non-https links in the summary and in change text instead of saving them silently", () => {
    expect(validateDraft(ok({ summary: "[bad](javascript:alert(1))" })).errors.summary).toBeTruthy();
    const r = validateDraft(ok({ changes: [{ type: "new", text: "fine" }, { type: "fixed", text: "[x](http://example.com)" }] }));
    expect(r.errors.changeRows).toEqual({ 1: "Links must start with https://." });
    expect(validateDraft(ok({ summary: "[good](https://example.com)" })).ok).toBe(true);
  });

  it("ignores empty rows when counting, and reports row numbers as the editor shows them", () => {
    const r = validateDraft(ok({ changes: [{ type: "new", text: "" }, { type: "new", text: "[x](ftp://a.b)" }] }));
    expect(r.errors.changeRows).toEqual({ 1: "Links must start with https://." });
  });

  it("validates ISO dates strictly", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("26-1-1")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("normalizeDraft / entryToDraft / emptyDraft / moveItem", () => {
  it("trims text and drops empty change rows", () => {
    const d = normalizeDraft({ ...emptyDraft("2026-01-01"), version: " v1 ", title: " T ", summary: " s ", changes: [{ type: "new", text: " a " }, { type: "fixed", text: "  " }] });
    expect(d).toMatchObject({ version: "v1", title: "T", summary: "s", changes: [{ type: "new", text: "a" }] });
  });

  it("round-trips an entry through the editor without sharing references", () => {
    const e = entry({ changes: [{ type: "fixed", text: "x" }] });
    const d = entryToDraft(e);
    d.changes[0].text = "changed";
    expect(e.changes[0].text).toBe("x");
    expect(entryToDraft(e)).toMatchObject({ version: e.version, status: "published", pinned: false });
  });

  it("starts a new draft as an unpublished, unpinned entry dated today with one blank change row", () => {
    expect(emptyDraft("2026-05-05")).toMatchObject({ date: "2026-05-05", status: "draft", pinned: false, changes: [{ type: "new", text: "" }] });
  });

  it("moves a row up or down, stopping at the ends", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a"], 5, 1)).toEqual(["a"]);
  });
});

describe("entryFromData", () => {
  const ts = (ms: number) => ({ toMillis: () => ms });

  it("reads a stored doc, converting timestamps", () => {
    const e = entryFromData("abc", { teamId: "t", version: "v1", title: "T", date: "2026-01-02", summary: "s", changes: [{ type: "fixed", text: "x" }], status: "published", pinned: true, createdBy: "u", createdAt: ts(1), updatedAt: ts(2), publishedAt: ts(3) });
    expect(e).toMatchObject({ id: "abc", status: "published", pinned: true, createdAtMs: 1, updatedAtMs: 2, publishedAtMs: 3, changes: [{ type: "fixed", text: "x" }] });
  });

  it("treats a pending server timestamp (null) and a missing one as unknown, not zero", () => {
    expect(entryFromData("a", { publishedAt: null, createdAt: undefined }).publishedAtMs).toBeNull();
    expect(timestampMs({})).toBeNull();
    expect(timestampMs("2026")).toBeNull();
  });

  it("survives malformed docs: drops bad change rows and defaults odd values", () => {
    const e = entryFromData("a", { version: 5, changes: [null, "x", { type: "huge", text: "no" }, { type: "new", text: 4 }, { type: "new", text: "ok" }], status: "weird", pinned: "yes" });
    expect(e.version).toBe("");
    expect(e.changes).toEqual([{ type: "new", text: "ok" }]);
    expect(e.status).toBe("draft"); // anything unrecognised is the safe, unpublished side
    expect(e.pinned).toBe(false);
    expect(entryFromData("a", { changes: "nope" }).changes).toEqual([]);
  });
});

describe("dates", () => {
  it("formats a local day as YYYY-MM-DD", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localIsoDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("formats an entry date without timezone drift, and passes junk through", () => {
    expect(formatEntryDate("2026-11-05")).toBe("Nov 5, 2026");
    expect(formatEntryDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatEntryDate("not a date")).toBe("not a date");
  });
});

describe("starter entries", () => {
  it("are valid, publishable-looking drafts: unique keys, real dates, safe text, at least one change each", () => {
    expect(STARTER_ENTRIES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(STARTER_ENTRIES.map((s) => s.key)).size).toBe(STARTER_ENTRIES.length);
    for (const s of STARTER_ENTRIES) {
      const draft: ChangelogDraft = { version: s.version, title: s.title, date: s.date, summary: s.summary, changes: s.changes, status: "draft", pinned: false };
      expect(validateDraft(draft), s.key).toEqual({ ok: true, errors: {} });
    }
  });

  it("are dated in order, oldest first", () => {
    const dates = STARTER_ENTRIES.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("have deterministic doc ids scoped to the team", () => {
    expect(starterDocId("teamA", "v0-1-0")).toBe("starter-teamA-v0-1-0");
    expect(starterDocId("teamA", "v0-1-0")).not.toBe(starterDocId("teamB", "v0-1-0"));
  });
});
