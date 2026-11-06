import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  MAX_SECTIONS,
  applyCreditsOp,
  describeOp,
  normalizeEntryFields,
  renumber,
  sameSections,
  sanitizeSections,
  validateEntryFields,
  validateSectionTitle,
  type CreditEntry,
  type CreditSection,
} from "./ops";
import { DEFAULT_CREDITS } from "./seed";

const entry = (id: string, over: Partial<CreditEntry> = {}): CreditEntry => ({ id, name: id, description: "", link: null, imageUrl: null, ...over });
const section = (id: string, entries: CreditEntry[] = [], order = 0): CreditSection => ({ id, title: id, order, entries });
const ids = (s: CreditSection[]) => s.map((x) => x.id);
const entryIds = (s: CreditSection) => s.entries.map((e) => e.id);

const base = (): CreditSection[] => renumber([section("a", [entry("a1"), entry("a2"), entry("a3")]), section("b", [entry("b1")]), section("c")]);

describe("sections", () => {
  it("adds a section at the end with the right order", () => {
    const next = applyCreditsOp(base(), { type: "add-section", id: "d", title: "D" });
    expect(ids(next)).toEqual(["a", "b", "c", "d"]);
    expect(next.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(next[3]).toMatchObject({ title: "D", entries: [] });
  });

  it("ignores a duplicate id and respects the section limit", () => {
    expect(ids(applyCreditsOp(base(), { type: "add-section", id: "a", title: "dup" }))).toEqual(["a", "b", "c"]);
    const full = renumber(Array.from({ length: MAX_SECTIONS }, (_, i) => section(`s${i}`)));
    expect(applyCreditsOp(full, { type: "add-section", id: "x", title: "x" })).toBe(full);
  });

  it("renames, deletes (renumbering), and moves sections", () => {
    expect(applyCreditsOp(base(), { type: "edit-section", sectionId: "b", title: "Renamed" })[1].title).toBe("Renamed");
    const deleted = applyCreditsOp(base(), { type: "delete-section", sectionId: "a" });
    expect(ids(deleted)).toEqual(["b", "c"]);
    expect(deleted.map((s) => s.order)).toEqual([0, 1]);
    const moved = applyCreditsOp(base(), { type: "move-section", sectionId: "c", toIndex: 0 });
    expect(ids(moved)).toEqual(["c", "a", "b"]);
    expect(moved.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(ids(applyCreditsOp(base(), { type: "move-section", sectionId: "a", toIndex: 99 }))).toEqual(["b", "c", "a"]);
  });

  it("never mutates its input", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    applyCreditsOp(input, { type: "delete-section", sectionId: "a" });
    applyCreditsOp(input, { type: "move-entry", fromSectionId: "a", entryId: "a1", toSectionId: "b", toIndex: 0 });
    applyCreditsOp(input, { type: "edit-entry", sectionId: "a", entryId: "a1", fields: { name: "z", description: "", link: null, imageUrl: null } });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("entries", () => {
  it("adds, edits, and deletes an entry", () => {
    const added = applyCreditsOp(base(), { type: "add-entry", sectionId: "b", entry: entry("b2") });
    expect(entryIds(added[1])).toEqual(["b1", "b2"]);
    const edited = applyCreditsOp(added, { type: "edit-entry", sectionId: "b", entryId: "b2", fields: { name: "New name", description: "d", link: "https://x.co", imageUrl: null } });
    expect(edited[1].entries[1]).toMatchObject({ id: "b2", name: "New name", link: "https://x.co" });
    expect(entryIds(applyCreditsOp(edited, { type: "delete-entry", sectionId: "b", entryId: "b1" })[1])).toEqual(["b2"]);
  });

  it("respects the per-section entry limit and duplicate ids", () => {
    const full = [section("a", Array.from({ length: MAX_ENTRIES }, (_, i) => entry(`e${i}`)))];
    expect(applyCreditsOp(full, { type: "add-entry", sectionId: "a", entry: entry("extra") })).toEqual(full);
    expect(entryIds(applyCreditsOp(base(), { type: "add-entry", sectionId: "a", entry: entry("a1") })[0])).toEqual(["a1", "a2", "a3"]);
  });

  it("reorders an entry within its section", () => {
    expect(entryIds(applyCreditsOp(base(), { type: "move-entry", fromSectionId: "a", entryId: "a3", toSectionId: "a", toIndex: 0 })[0])).toEqual(["a3", "a1", "a2"]);
    expect(entryIds(applyCreditsOp(base(), { type: "move-entry", fromSectionId: "a", entryId: "a1", toSectionId: "a", toIndex: 2 })[0])).toEqual(["a2", "a3", "a1"]);
  });

  it("moves an entry to another section at a position, removing it from the first", () => {
    const next = applyCreditsOp(base(), { type: "move-entry", fromSectionId: "a", entryId: "a2", toSectionId: "b", toIndex: 0 });
    expect(entryIds(next[0])).toEqual(["a1", "a3"]);
    expect(entryIds(next[1])).toEqual(["a2", "b1"]);
    const intoEmpty = applyCreditsOp(base(), { type: "move-entry", fromSectionId: "a", entryId: "a1", toSectionId: "c", toIndex: 5 });
    expect(entryIds(intoEmpty[2])).toEqual(["a1"]);
  });

  it("doesn't move into a full section", () => {
    const full = [section("a", [entry("x")]), section("b", Array.from({ length: MAX_ENTRIES }, (_, i) => entry(`e${i}`)), 1)];
    expect(applyCreditsOp(full, { type: "move-entry", fromSectionId: "a", entryId: "x", toSectionId: "b", toIndex: 0 })).toBe(full);
  });
});

describe("stale ops (someone else changed the doc first)", () => {
  it("leave the sections untouched", () => {
    const input = base();
    for (const op of [
      { type: "edit-section", sectionId: "gone", title: "x" },
      { type: "delete-section", sectionId: "gone" },
      { type: "move-section", sectionId: "gone", toIndex: 0 },
      { type: "add-entry", sectionId: "gone", entry: entry("n") },
      { type: "edit-entry", sectionId: "a", entryId: "gone", fields: { name: "x", description: "", link: null, imageUrl: null } },
      { type: "delete-entry", sectionId: "a", entryId: "gone" },
      { type: "move-entry", fromSectionId: "a", entryId: "gone", toSectionId: "b", toIndex: 0 },
      { type: "move-entry", fromSectionId: "a", entryId: "a1", toSectionId: "gone", toIndex: 0 },
    ] as const) {
      expect(sameSections(applyCreditsOp(input, op), input), op.type).toBe(true);
    }
  });

  it("two admins' edits compose when replayed on the latest data", () => {
    // Admin 1 added "b2"; admin 2 (working from older data) renames section "b". Replayed in order, both survive.
    const afterAdmin1 = applyCreditsOp(base(), { type: "add-entry", sectionId: "b", entry: entry("b2") });
    const afterBoth = applyCreditsOp(afterAdmin1, { type: "edit-section", sectionId: "b", title: "Renamed" });
    expect(afterBoth[1].title).toBe("Renamed");
    expect(entryIds(afterBoth[1])).toEqual(["b1", "b2"]);
  });
});

describe("sanitizeSections", () => {
  it("returns an empty list for junk", () => {
    expect(sanitizeSections(undefined)).toEqual([]);
    expect(sanitizeSections("nope")).toEqual([]);
    expect(sanitizeSections([null, 3, {}, { id: 5 }])).toEqual([]);
  });

  it("drops malformed entries, coerces fields, sorts by order, and renumbers", () => {
    const out = sanitizeSections([
      { id: "second", title: "Second", order: 5, entries: [{ id: "e", name: "N", description: 7, link: "https://ok.co", imageUrl: "javascript:alert(1)" }, null, { name: "no id" }] },
      { id: "first", title: "First", order: 1 },
    ]);
    expect(ids(out)).toEqual(["first", "second"]);
    expect(out.map((s) => s.order)).toEqual([0, 1]);
    expect(out[1].entries).toEqual([{ id: "e", name: "N", description: "", link: "https://ok.co", imageUrl: null }]);
  });

  it("discards non-https links and images read from storage", () => {
    const [s] = sanitizeSections([{ id: "s", title: "S", order: 0, entries: [{ id: "e", name: "N", description: "", link: "http://insecure.co", imageUrl: "data:image/png;base64,AAAA" }] }]);
    expect(s.entries[0]).toMatchObject({ link: null, imageUrl: null });
  });
});

describe("validation", () => {
  const fields = (over = {}) => ({ name: "Ada", description: "Lead", link: null, imageUrl: null, ...over });

  it("accepts a normal entry and a fully optional one", () => {
    expect(validateEntryFields(fields()).ok).toBe(true);
    expect(validateEntryFields(fields({ link: "https://example.com/a", imageUrl: "https://example.com/a.png" })).ok).toBe(true);
  });

  it("requires a name and enforces length limits", () => {
    expect(validateEntryFields(fields({ name: "" })).errors.name).toBeTruthy();
    expect(validateEntryFields(fields({ name: "x".repeat(81) })).errors.name).toBeTruthy();
    expect(validateEntryFields(fields({ description: "x".repeat(301) })).errors.description).toBeTruthy();
  });

  it("allows only https for the link and the image", () => {
    for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,hi", "//example.com", "example.com", "ftp://example.com"]) {
      expect(validateEntryFields(fields({ link: bad })).errors.link, bad).toBeTruthy();
      expect(validateEntryFields(fields({ imageUrl: bad })).errors.imageUrl, bad).toBeTruthy();
    }
  });

  it("flags non-https links inside the description's markup", () => {
    expect(validateEntryFields(fields({ description: "[x](javascript:alert(1))" })).errors.description).toBeTruthy();
    expect(validateEntryFields(fields({ description: "see [site](https://example.com)" })).ok).toBe(true);
  });

  it("normalizes blank optional URLs to null and trims", () => {
    expect(normalizeEntryFields({ name: " Ada ", description: " Lead ", link: "  ", imageUrl: " https://x.co/a.png " })).toEqual({ name: "Ada", description: "Lead", link: null, imageUrl: "https://x.co/a.png" });
  });

  it("validates section titles", () => {
    expect(validateSectionTitle("Team")).toBeNull();
    expect(validateSectionTitle("   ")).toBeTruthy();
    expect(validateSectionTitle("x".repeat(81))).toBeTruthy();
  });
});

describe("default credits", () => {
  it("include the sections the page promises, in order", () => {
    expect(DEFAULT_CREDITS.map((s) => s.title)).toEqual(["Built with AI", "Team", "Built with", "Data"]);
    expect(DEFAULT_CREDITS.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(DEFAULT_CREDITS[0].entries[0].name).toContain("Claude");
  });

  it("have unique ids and valid entries (so an edit made on the defaults replays on the stored copy)", () => {
    expect(new Set(DEFAULT_CREDITS.map((s) => s.id)).size).toBe(DEFAULT_CREDITS.length);
    const all = DEFAULT_CREDITS.flatMap((s) => s.entries);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all) expect(validateEntryFields(e), e.id).toEqual({ ok: true, errors: {} });
  });

  it("survive a sanitize round trip unchanged", () => {
    expect(sanitizeSections(JSON.parse(JSON.stringify(DEFAULT_CREDITS)))).toEqual(DEFAULT_CREDITS);
  });
});

describe("describeOp", () => {
  it("gives the audit log a compact description", () => {
    expect(describeOp({ type: "delete-entry", sectionId: "a", entryId: "a1" })).toEqual({ op: "delete-entry", sectionId: "a", entryId: "a1" });
    expect(describeOp({ type: "add-section", id: "z", title: "Z" })).toMatchObject({ op: "add-section", title: "Z" });
  });
});
