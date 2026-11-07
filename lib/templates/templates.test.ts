import { describe, expect, it } from "vitest";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { createBlankForm } from "@/lib/forms/new-form";
import { addField, defaultField, repairDuplicates, updateField } from "@/lib/forms/edit";
import { exportForm, exportFormJson, formChecksum, importForm } from "@/lib/forms/portable";
import { nonHttpsLinks, sanitizeFormText, stripHtml, textSlots } from "@/lib/forms/sanitize";
import { checkForm, parseForm } from "@/lib/forms/validate";
import { buildTemplateContent, checksumMatches, cleanTags, filterTemplates, formFromTemplate, templateTags, updateAvailable, TEMPLATE_LIMITS, type FormTemplate } from "@/lib/templates/build";
import { officialTemplates } from "@/lib/templates/official";
import type { Form } from "@/lib/forms/types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const blank = (name = "Pit"): Form => ({ ...createBlankForm({ id: "pit", name, createdBy: "u1" }), scoringEnabled: false });

function template(over: Partial<FormTemplate> & { id: string }): FormTemplate {
  const built = buildTemplateContent({ form: blank(), name: over.name ?? "T", description: over.description, tags: over.tags });
  if (!built.ok) throw new Error(built.errors.join());
  return { visibility: "public", ownerTeamId: "t1", authorName: "Team 1", official: false, version: 1, importCount: 0, reportCount: 0, ...built.content, ...over } as FormTemplate;
}

describe("sanitizing shared text", () => {
  it("strips real HTML but keeps a bare less-than", () => {
    expect(stripHtml("Hi <b>there</b><script>x()</script>")).toBe("Hi thereX()".replace("X", "x"));
    expect(stripHtml("under < 5 and over > 3")).toBe("under < 5 and over > 3");
    expect(stripHtml("a <!-- c --> b")).toBe("a  b");
  });

  it("finds links that aren't https, and the opaque schemes", () => {
    expect(nonHttpsLinks("see https://example.com/a and http://evil.example")).toEqual(["http://evil.example"]);
    expect(nonHttpsLinks("javascript:alert(1)")).toHaveLength(1);
    expect(nonHttpsLinks("data:text/html,x mailto:a@b.c ftp://x")).toHaveLength(3);
    expect(nonHttpsLinks("Hive: 3 pts, Auto: yes, ratio 1:2")).toEqual([]);
    expect(nonHttpsLinks("HTTPS://Example.com")).toEqual([]);
  });

  it("cleans every text slot of a form and reports bad links without rewriting them", () => {
    let f = blank();
    f = addField(f, "teleop", { ...defaultField(f, "toggle", "Parked"), helpText: "<i>Fully</i> parked", tip: "More: http://x.example/help", options: undefined });
    const r = sanitizeFormText(f);
    expect(r.stripped).toBe(1);
    expect(textSlots(r.form).some((t) => t.value.includes("<i>"))).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("tip");
  });
});

describe("building a template from a form", () => {
  it("makes the portable snapshot with counts and a checksum, and tags tidied", () => {
    const r = buildTemplateContent({ form: BIOBUZZ_FORM, name: "  BIOBUZZ  ", description: "d", tags: ["BIOBUZZ", "biobuzz", " 2026 ", "<b>x</b>"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.name).toBe("BIOBUZZ");
    expect(r.content.tags).toEqual(["biobuzz", "2026", "x"]);
    expect(r.content.fieldCount).toBeGreaterThan(10);
    expect(r.content.form).toMatchObject({ origin: "custom", version: 0, status: "draft", createdBy: "" });
    expect(r.content.form.baseBuiltInId).toBeUndefined();
    expect(checksumMatches({ form: r.content.form, checksum: r.content.checksum })).toBe(true);
    expect(checksumMatches({ form: { ...r.content.form, name: "Other" }, checksum: r.content.checksum })).toBe(false);
  });

  it("refuses a nameless template, blocking problems, HTML-only names and non-https links, and accepts a maximal form", () => {
    expect(buildTemplateContent({ form: blank(), name: " " })).toMatchObject({ ok: false });
    expect(buildTemplateContent({ form: blank(), name: "<b></b>" })).toMatchObject({ ok: false });
    const scoringOnNothing = { ...blank(), scoringEnabled: true };
    const r = buildTemplateContent({ form: scoringOnNothing, name: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("Fix 1 problem");
    expect(buildTemplateContent({ form: blank(), name: "x", description: "go to http://evil.example" })).toMatchObject({ ok: false });
    let big = blank();
    for (let i = 0; i < 80; i++) big = addField(big, "teleop", { ...defaultField(big, "textarea", `Long ${i}`), helpText: "x".repeat(300), tip: "y".repeat(300) });
    for (let i = 0; i < 80; i++) big = addField(big, "autonomous", { ...defaultField(big, "textarea", `Longer ${i}`), helpText: "x".repeat(300), tip: "y".repeat(300) });
    for (let i = 0; i < 80; i++) big = addField(big, "endgame", { ...defaultField(big, "textarea", `Longest ${i}`), helpText: "x".repeat(300), tip: "y".repeat(300) });
    // the schema's own limits (300 fields, bounded text) keep even a maximal form under the template size limit: the byte limit is a backstop
    big = { ...big, scoringEnabled: false };
    const size = JSON.stringify(big).length;
    expect(size).toBeGreaterThan(150_000);
    expect(size).toBeLessThan(TEMPLATE_LIMITS.jsonBytes);
    expect(buildTemplateContent({ form: big, name: "Huge" }).ok).toBe(true);
  });

  it("strips HTML and says so", () => {
    let f = blank();
    f = addField(f, "teleop", { ...defaultField(f, "toggle", "Parked"), helpText: "<b>bold</b>" });
    const r = buildTemplateContent({ form: f, name: "x" });
    expect(r.ok && r.notes).toEqual(["HTML was removed from 1 text."]);
  });

  it("the official templates are valid, public-ready content", () => {
    const [biobuzz, starter] = officialTemplates();
    expect(biobuzz.id).toBe("official-biobuzz");
    expect(biobuzz.content.form.sections.some((s) => s.fields.some((f) => f.key === "autoLeave"))).toBe(true);
    expect(biobuzz.content.tags).toContain("biobuzz");
    expect(starter.id).toBe("official-blank");
    expect(starter.content.form.sections.map((s) => s.title)).toEqual(["Pre-Match", "Autonomous", "Teleoperated", "Endgame", "Misc"]);
    expect(starter.content.form.sections[0].fields.map((f) => f.type)).toEqual(["matchPicker", "scoutName", "teamPicker"]);
    for (const t of [biobuzz, starter]) {
      expect(parseForm(t.content.form).ok).toBe(true);
      expect(checkForm(t.content.form).filter((i) => i.severity === "error")).toEqual([]);
    }
  });
});

describe("using a template", () => {
  it("makes a unique draft that remembers where it came from", () => {
    const t = template({ id: "tpl1", name: "Pit scouting", version: 3 });
    const f = formFromTemplate(t, { taken: new Set(["pit-scouting"]), createdBy: "u9", now: 7 });
    expect(f).toMatchObject({ id: "pit-scouting-2", name: "Pit scouting", origin: "template", templateId: "tpl1", templateVersion: 3, version: 0, status: "draft", createdBy: "u9" });
    expect(f.sections).toEqual(t.form.sections);
    expect(f.sections).not.toBe(t.form.sections);
    expect(formFromTemplate(t, { name: "Mine", taken: new Set(), createdBy: "u" }).id).toBe("mine");
  });

  it("offers an update only for a newer version of the same template", () => {
    const form = { templateId: "tpl1", templateVersion: 2 };
    expect(updateAvailable(form, { id: "tpl1", version: 3 })).toBe(true);
    expect(updateAvailable(form, { id: "tpl1", version: 2 })).toBe(false);
    expect(updateAvailable(form, { id: "other", version: 9 })).toBe(false);
    expect(updateAvailable(form, null)).toBe(false);
    expect(updateAvailable({}, { id: "tpl1", version: 9 })).toBe(false);
  });
});

describe("library search, tags and sorting", () => {
  const list = [
    template({ id: "a", name: "BIOBUZZ Match Scout", tags: ["biobuzz", "2026"], importCount: 50, publishedAt: 100, official: true, authorName: "CompEpicurus" }),
    template({ id: "b", name: "Pit scouting", description: "Robot inspection", tags: ["pit"], importCount: 5, publishedAt: 300 }),
    template({ id: "c", name: "Driver feedback", tags: ["pit", "drive"], importCount: 20, publishedAt: 200, authorName: "Team Nine" }),
  ];
  it("sorts newest and most used", () => {
    expect(filterTemplates(list, { sort: "newest" }).map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(filterTemplates(list, { sort: "popular" }).map((t) => t.id)).toEqual(["a", "c", "b"]);
  });
  it("searches name, description, tags and author, every word", () => {
    expect(filterTemplates(list, { q: "inspection" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTemplates(list, { q: "team nine" }).map((t) => t.id)).toEqual(["c"]);
    expect(filterTemplates(list, { q: "pit nothing" })).toEqual([]);
    expect(filterTemplates(list, { q: "BIOBUZZ" }).map((t) => t.id)).toEqual(["a"]);
  });
  it("filters by tag and official, and lists tags by use", () => {
    expect(filterTemplates(list, { tag: "pit" }).map((t) => t.id).sort()).toEqual(["b", "c"]);
    expect(filterTemplates(list, { officialOnly: true }).map((t) => t.id)).toEqual(["a"]);
    expect(templateTags(list)[0]).toEqual({ tag: "pit", count: 2 });
  });
  it("normalizes tags", () => {
    expect(cleanTags(["A", "a", " b ", "", "x".repeat(50)])).toEqual(["a", "b", "x".repeat(30)]);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(TEMPLATE_LIMITS.tags);
  });
});

describe("JSON import and export", () => {
  it("exports the schema version and a checksum, and a clean import has no warnings", () => {
    const e = exportForm(blank());
    expect(e).toMatchObject({ format: "compepicurus-form", formatVersion: 1 });
    expect(e.checksum).toBe(formChecksum(blank()));
    const r = importForm(exportFormJson(blank()));
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.changes).toEqual([]);
  });

  it("warns (without refusing) when the checksum doesn't match", () => {
    const text = JSON.parse(exportFormJson(blank()));
    text.form.description = "edited by hand";
    const r = importForm(JSON.stringify(text));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("checksum-mismatch");
    const noChecksum = { ...text };
    delete noChecksum.checksum;
    const r2 = importForm(JSON.stringify(noChecksum));
    expect(r2.ok && r2.warnings.map((w) => w.code)).not.toContain("checksum-mismatch");
  });

  it("strips HTML on the way in, and refuses links that aren't https", () => {
    const raw = JSON.parse(exportFormJson(blank()));
    raw.form.description = "A <b>pit</b> form";
    delete raw.checksum;
    const r = importForm(JSON.stringify(raw));
    expect(r.ok && r.form.description).toBe("A pit form");
    expect(r.ok && r.changes).toEqual(["HTML was removed from 1 text."]);
    raw.form.description = "see http://evil.example";
    expect(importForm(JSON.stringify(raw))).toMatchObject({ ok: false });
  });

  it("rejects unknown field types, bad formats and oversized files with clear errors", () => {
    const raw = JSON.parse(exportFormJson(blank()));
    raw.form.sections[2].fields.push({ id: "x", key: "x", type: "hologram", label: "X" });
    expect(importForm(JSON.stringify(raw))).toMatchObject({ ok: false });
    expect(importForm("[]")).toMatchObject({ ok: false });
    expect(importForm({ format: "compepicurus-form", formatVersion: 2, form: {} })).toMatchObject({ ok: false });
    expect(importForm("x".repeat(600_000))).toMatchObject({ ok: false });
  });

  it("refuses duplicate keys by default and can fix them automatically, saying what it did", () => {
    let f = blank();
    f = addField(f, "teleop", defaultField(f, "toggle", "Parked"));
    f = addField(f, "teleop", defaultField(f, "toggle", "Parked 2"));
    const [a, b] = f.sections.find((s) => s.id === "teleop")!.fields;
    f = updateField(f, b.id, { key: a.key });
    const text = exportFormJson(f);
    const refused = importForm(text);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.join(" ")).toContain("must be unique");
    const fixed = importForm(text, { repairDuplicates: true });
    expect(fixed.ok).toBe(true);
    if (fixed.ok) {
      expect(fixed.changes[0]).toContain(`Two fields used the key "${a.key}"`);
      expect(new Set(fixed.form.sections.flatMap((s) => s.fields.map((x) => x.key))).size).toBe(fixed.form.sections.flatMap((s) => s.fields).length);
    }
  });

  it("repairs duplicate ids too, and leaves a clean form alone", () => {
    const f = blank();
    expect(repairDuplicates(f).form).toBe(f);
    const dup = clone(f);
    dup.sections[2].id = dup.sections[1].id;
    dup.sections[1].fields.push({ ...defaultField(f, "toggle", "A"), id: "same", key: "aa" });
    dup.sections[2].fields.push({ ...defaultField(f, "toggle", "B"), id: "same", key: "bb" });
    const r = repairDuplicates(dup);
    expect(r.fixes.length).toBe(2);
    expect(new Set(r.form.sections.map((s) => s.id)).size).toBe(r.form.sections.length);
    expect(new Set(r.form.sections.flatMap((s) => s.fields.map((x) => x.id))).size).toBe(r.form.sections.flatMap((s) => s.fields).length);
  });
});
