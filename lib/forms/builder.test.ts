import { describe, expect, it } from "vitest";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { createBlankForm } from "@/lib/forms/new-form";
import { checkForm, parseForm } from "@/lib/forms/validate";
import {
  addField,
  addGroup,
  addSection,
  allIds,
  cloneFields,
  defaultField,
  duplicateField,
  duplicateSection,
  findField,
  insertFromForm,
  isSystemField,
  keyFromLabel,
  keyProblem,
  keysOf,
  layoutOf,
  moveField,
  moveFieldBy,
  moveGroupBy,
  moveSectionBy,
  moveSectionTo,
  newId,
  phaseKeyFromName,
  removeField,
  removeGroup,
  removeSection,
  setFieldKey,
  setPhaseLabel,
  uniqueKey,
  updateField,
  updateFields,
  updateSection,
} from "@/lib/forms/edit";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from "@/lib/forms/history";
import { describeScoring, diffForms } from "@/lib/forms/diff";
import type { Form } from "@/lib/forms/types";

const blank = (): Form => createBlankForm({ id: "pit", name: "Pit", createdBy: "u1" });
/** A deterministic id source. */
const seq = () => {
  let n = 0;
  return () => (n += 1) / 1e7;
};
const section = (f: Form, id: string) => f.sections.find((s) => s.id === id)!;
const keys = (f: Form) => f.sections.flatMap((s) => s.fields.map((x) => x.key));
const noErrors = (f: Form, except: string[] = []) => checkForm(f).filter((i) => i.severity === "error" && !except.includes(i.code));

describe("keys and ids", () => {
  it("makes camelCase keys from labels, always valid", () => {
    expect(keyFromLabel("Auto Park (full)")).toBe("autoParkFull");
    expect(keyFromLabel("123 go")).toBe("field123Go");
    expect(keyFromLabel("")).toBe("field");
    expect(keyFromLabel("Zażółć gęślą")).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    expect(keyFromLabel("x".repeat(100)).length).toBeLessThanOrEqual(36);
  });

  it("makes keys unique against fields and both ends of aliases", () => {
    const f = { ...blank(), keyAliases: { oldKey: "comments" } };
    expect(uniqueKey(f, "samples")).toBe("samples");
    expect(uniqueKey(f, "comments")).toBe("comments2");
    expect(uniqueKey(f, "oldKey")).toBe("oldKey2");
    expect(uniqueKey(f, "bad key!")).toBe("badKey");
  });

  it("creates ids that are never already taken", () => {
    const taken = new Set(["f-0000001"]);
    const id = newId("f", taken, () => 0);
    expect(id.startsWith("f-")).toBe(true);
    const once = newId("f", new Set(), () => 0);
    expect(newId("f", new Set([once]), () => 0)).not.toBe(once);
  });

  it("explains why a key can't be used", () => {
    let f = blank();
    f = addField(f, "teleop", defaultField(f, "counter", "Samples"));
    f = addField(f, "teleop", defaultField(f, "toggle", "Parked"));
    const [a, b] = f.sections.find((s) => s.id === "teleop")!.fields;
    expect(keyProblem(f, a.id, "1bad")).toMatch(/letters/);
    expect(keyProblem(f, a.id, b.key)).toMatch(/already uses/);
    expect(keyProblem(f, a.id, "fresh")).toBeNull();
  });
});

describe("new fields", () => {
  it("each type gets the settings it needs and is valid on its own", () => {
    for (const type of ["toggle", "counter", "checkbox", "number", "text", "textarea", "select", "radio", "rating"] as const) {
      let f = blank();
      f = addField(f, "teleop", defaultField(f, type));
      f = { ...f, scoringEnabled: false };
      expect(noErrors(f), type).toEqual([]);
    }
    const f = blank();
    expect(defaultField(f, "counter")).toMatchObject({ min: 0, step: 1, analytics: { aggregate: "avg" } });
    expect(defaultField(f, "rating").scale).toBe(5);
    expect(defaultField(f, "select").options).toHaveLength(2);
    expect(defaultField(f, "toggle").scoring).toEqual({ mode: "none" });
  });

  it("result always passes the strict parser", () => {
    let f = blank();
    f = addField(f, "teleop", defaultField(f, "select", "Parked where?"));
    expect(parseForm(f).ok).toBe(true);
  });
});

describe("adding, removing and moving fields", () => {
  const withThree = () => {
    let f = blank();
    const r = seq();
    for (const label of ["A", "B", "C"]) f = addField(f, "teleop", defaultField(f, "toggle", label, r));
    return f;
  };
  const labels = (f: Form, sectionId: string) => section(f, sectionId).fields.map((x) => x.label);

  it("adds at an index and into a group, and ignores system fields and unknown places", () => {
    let f = withThree();
    f = addField(f, "teleop", defaultField(f, "counter", "Z"), { index: 0 });
    expect(labels(f, "teleop")).toEqual(["Z", "A", "B", "C"]);
    const g = addGroup(f, "teleop", "Hive");
    f = addField(g.form, "teleop", defaultField(g.form, "counter", "In hive"), { groupId: g.id! });
    expect(layoutOf(section(f, "teleop")).groups[0].fields.map((x) => x.label)).toEqual(["In hive"]);
    expect(addField(f, "nope", defaultField(f, "toggle"))).toBe(f);
    const sys = { ...defaultField(f, "toggle"), type: "scoutName" as const, key: "scoutName" }; // a system field is a picker of a system type with its fixed key (P27)
    expect(addField(f, "teleop", sys)).toBe(f);
  });

  it("removes a field, drops conditions that depended on it, and never removes a system field", () => {
    let f = withThree();
    const [a, b] = section(f, "teleop").fields;
    f = updateField(f, b.id, { visibleWhen: { fieldKey: a.key, op: "checked" } });
    f = removeField(f, a.id);
    expect(labels(f, "teleop")).toEqual(["B", "C"]);
    expect(findField(f, b.id)!.field.visibleWhen).toBeUndefined();
    const sysId = section(f, "pre-match").fields[0].id;
    expect(removeField(f, sysId)).toBe(f);
  });

  it("moves between categories and groups, keeping everything else in order", () => {
    let f = withThree();
    const [a] = section(f, "teleop").fields;
    f = moveField(f, a.id, { sectionId: "endgame", index: 0 });
    expect(labels(f, "teleop")).toEqual(["B", "C"]);
    expect(labels(f, "endgame")).toEqual(["A"]);
    const g = addGroup(f, "endgame", "G");
    f = moveField(g.form, a.id, { sectionId: "endgame", groupId: g.id!, index: 0 });
    expect(findField(f, a.id)!.field.groupId).toBe(g.id);
    f = moveField(f, a.id, { sectionId: "teleop", groupId: "not-there", index: 99 });
    expect(labels(f, "teleop")).toEqual(["B", "C", "A"]);
    expect(findField(f, a.id)!.field.groupId).toBeUndefined();
  });

  it("locks the system fields to Pre-Match", () => {
    const f = blank();
    const sys = section(f, "pre-match").fields[1];
    expect(moveField(f, sys.id, { sectionId: "teleop", index: 0 })).toBe(f);
    const moved = moveField(f, sys.id, { sectionId: "pre-match", index: 0 });
    expect(section(moved, "pre-match").fields[0].id).toBe(sys.id);
    expect(isSystemField(sys)).toBe(true);
    expect(updateField(f, sys.id, { key: "hacked", type: "toggle", required: false })).toMatchObject({ sections: expect.any(Array) });
    const patched = findField(updateField(f, sys.id, { key: "hacked", type: "toggle", required: false }), sys.id)!.field;
    expect(patched).toMatchObject({ key: sys.key, type: sys.type, required: true });
  });

  it("moveFieldBy steps inside a category, then crosses into the neighbour, and stops at the ends", () => {
    let f = withThree();
    const [a, , c] = section(f, "teleop").fields;
    f = moveFieldBy(f, a.id, 1);
    expect(labels(f, "teleop")).toEqual(["B", "A", "C"]);
    f = moveFieldBy(f, c.id, 1); // last in teleop -> first in endgame
    expect(labels(f, "endgame")).toEqual(["C"]);
    f = moveFieldBy(f, c.id, -1); // first in endgame -> end of teleop
    expect(labels(f, "teleop")).toEqual(["B", "A", "C"]);
    const first = section(f, "pre-match").fields[0];
    expect(moveFieldBy(f, first.id, -1)).toBe(f); // nothing above Pre-Match
    expect(moveFieldBy(f, "nope", 1)).toBe(f);
  });

  it("duplicates a field with a new id, a unique key and no stat roles; not a system field", () => {
    let f = blank();
    f = addField(f, "teleop", { ...defaultField(f, "toggle", "Died"), statRoles: ["died"] });
    const orig = section(f, "teleop").fields[0];
    const { form: g, id } = duplicateField(f, orig.id);
    const copy = findField(g, id!)!.field;
    expect(copy.label).toBe("Died (copy)");
    expect(copy.key).not.toBe(orig.key);
    expect(copy.id).not.toBe(orig.id);
    expect(copy.statRoles).toBeUndefined();
    expect(section(g, "teleop").fields.map((x) => x.id)).toEqual([orig.id, copy.id]);
    expect(duplicateField(f, section(f, "pre-match").fields[0].id).id).toBeNull();
  });

  it("updates one field, or many at once (bulk), skipping system fields", () => {
    let f = withThree();
    const ids = section(f, "teleop").fields.map((x) => x.id);
    f = updateFields(f, [...ids, section(f, "pre-match").fields[0].id], (x) => ({ ...x, required: true }));
    expect(section(f, "teleop").fields.every((x) => x.required)).toBe(true);
    expect(section(f, "pre-match").fields[0].required).toBe(true); // always was
    expect(updateField(f, ids[0], (x) => ({ ...x, label: "Z" })).sections.find((s) => s.id === "teleop")!.fields[0].label).toBe("Z");
  });

  it("respects the form's size limits", () => {
    let f = blank();
    for (let i = 0; i < 90; i++) f = addField(f, "teleop", defaultField(f, "toggle", `T${i}`));
    expect(section(f, "teleop").fields.length).toBe(80);
  });
});

describe("renaming a key", () => {
  const form = () => {
    let f = blank();
    f = addField(f, "teleop", defaultField(f, "counter", "Samples"));
    f = addField(f, "teleop", defaultField(f, "toggle", "Bonus"));
    const [s, b] = section(f, "teleop").fields;
    f = updateField(f, b.id, { visibleWhen: { fieldKey: s.key, op: "gt", value: 2 } });
    return { f, s, b };
  };

  it("makes a new field's rename simple: no alias, and conditions follow", () => {
    const { f, s, b } = form();
    const g = setFieldKey(f, s.id, "specimens");
    expect(findField(g, s.id)!.field.key).toBe("specimens");
    expect(findField(g, b.id)!.field.visibleWhen).toMatchObject({ fieldKey: "specimens" });
    expect(g.keyAliases).toBeUndefined();
    expect(noErrors(g, ["scoring-empty"])).toEqual([]);
  });

  it("leaves an alias when the old key was ever published, and collapses chains", () => {
    const { f, s } = form();
    const published = new Set(["samples"]);
    let g = setFieldKey(f, s.id, "specimens", published);
    expect(g.keyAliases).toEqual({ samples: "specimens" });
    g = setFieldKey(g, s.id, "pieces", new Set([...published, "specimens"]));
    expect(g.keyAliases).toEqual({ samples: "pieces", specimens: "pieces" });
    expect(noErrors(g, ["scoring-empty"])).toEqual([]);
  });

  it("drops the alias when a field is renamed back", () => {
    const { f, s } = form();
    let g = setFieldKey(f, s.id, "specimens", new Set(["samples"]));
    expect(keyProblem(g, s.id, "samples")).toBeNull();
    g = setFieldKey(g, s.id, "samples", new Set(["samples", "specimens"]));
    expect(g.keyAliases?.samples).toBeUndefined();
    expect(findField(g, s.id)!.field.key).toBe("samples");
  });

  it("refuses unusable keys, and a system field's key", () => {
    const { f, s, b } = form();
    expect(setFieldKey(f, s.id, b.key)).toBe(f);
    expect(setFieldKey(f, s.id, "1x")).toBe(f);
    expect(setFieldKey(f, section(f, "pre-match").fields[0].id, "other")).toBe(f);
    expect(setFieldKey(f, s.id, s.key)).toBe(f);
  });
});

describe("categories and groups", () => {
  it("adds, renames, hides, re-phases and reorders categories", () => {
    let f = blank();
    const r = seq();
    const a = addSection(f, { title: "Parking", phase: "endgame" }, r);
    f = a.form;
    expect(f.sections.at(-1)).toMatchObject({ title: "Parking", phase: "endgame", visible: true, fields: [] });
    f = updateSection(f, a.id!, { title: "Park zone", visible: false, accent: "warning" });
    expect(section(f, a.id!)).toMatchObject({ title: "Park zone", visible: false, accent: "warning" });
    f = moveSectionBy(f, a.id!, -1);
    expect(f.sections.at(-2)!.id).toBe(a.id);
    f = moveSectionTo(f, a.id!, 0);
    expect(f.sections[0].id).toBe(a.id);
    expect(moveSectionBy(f, a.id!, -1)).toBe(f);
    expect(parseForm(f).ok).toBe(true);
  });

  it("won't delete or re-phase a category holding the system fields", () => {
    const f = blank();
    expect(removeSection(f, "pre-match")).toBe(f);
    expect(updateSection(f, "pre-match", { phase: "teleop" })).toBe(f);
    expect(updateSection(f, "pre-match", { title: "Before the match" }).sections[0].title).toBe("Before the match");
  });

  it("deleting a category removes its fields and the conditions that pointed at them", () => {
    let f = blank();
    f = addField(f, "autonomous", defaultField(f, "toggle", "Left"));
    const left = section(f, "autonomous").fields[0];
    f = addField(f, "teleop", { ...defaultField(f, "counter", "Bonus"), visibleWhen: { fieldKey: left.key, op: "checked" } });
    f = removeSection(f, "autonomous");
    expect(f.sections.find((s) => s.id === "autonomous")).toBeUndefined();
    expect(section(f, "teleop").fields[0].visibleWhen).toBeUndefined();
    expect(noErrors(f, ["scoring-empty"])).toEqual([]);
  });

  it("duplicates a category with fresh ids and keys, groups remapped, system fields left behind", () => {
    let f = blank();
    const g = addGroup(f, "teleop", "Hive", seq());
    f = addField(g.form, "teleop", defaultField(g.form, "counter", "Tips"), { groupId: g.id! });
    const { form: d, id } = duplicateSection(f, "teleop", seq());
    const copy = section(d, id!);
    expect(copy.title).toBe("Teleoperated (copy)");
    expect(copy.groups![0].id).not.toBe(g.id);
    expect(copy.fields[0].groupId).toBe(copy.groups![0].id);
    expect(copy.fields[0].key).not.toBe(section(d, "teleop").fields[0].key);
    expect(noErrors(d, ["scoring-empty"])).toEqual([]);
    const pre = duplicateSection(blank(), "pre-match", seq()).form;
    expect(pre.sections.find((s) => s.title.endsWith("(copy)"))!.fields).toEqual([]);
    expect(new Set(keys(d)).size).toBe(keys(d).length);
  });

  it("groups: add, rename, reorder, and removing one keeps its fields, ungrouped", () => {
    let f = blank();
    const a = addGroup(f, "teleop", "One", seq());
    const b = addGroup(a.form, "teleop", "Two", seq());
    f = addField(b.form, "teleop", defaultField(b.form, "toggle", "In one"), { groupId: a.id! });
    f = moveGroupBy(f, "teleop", a.id!, 1);
    expect(section(f, "teleop").groups!.map((x) => x.title)).toEqual(["Two", "One"]);
    f = removeGroup(f, "teleop", a.id!);
    expect(section(f, "teleop").groups!.map((x) => x.title)).toEqual(["Two"]);
    expect(section(f, "teleop").fields[0].groupId).toBeUndefined();
    f = removeGroup(f, "teleop", b.id!);
    expect(section(f, "teleop").groups).toBeUndefined();
    expect(parseForm(f).ok).toBe(true);
  });

  it("custom phases get readable labels and unique keys", () => {
    let f = blank();
    expect(phaseKeyFromName(f, "Pit Stop!")).toBe("pit-stop");
    const a = addSection(f, { title: "Pit", phase: "pit-stop" });
    f = setPhaseLabel(a.form, "pit-stop", "Pit stop");
    expect(f.phaseLabels).toEqual({ "pit-stop": "Pit stop" });
    expect(phaseKeyFromName(f, "Pit Stop")).toBe("pit-stop-2");
    expect(setPhaseLabel(f, "pit-stop", " ").phaseLabels).toBeUndefined();
    expect(phaseKeyFromName(f, "123")).toBe("custom");
  });
});

describe("Insert from BIOBUZZ (cloning)", () => {
  it("clones a whole category, with its points, fresh ids and the same keys when free", () => {
    const f = blank();
    const sourceSection = BIOBUZZ_FORM.sections.find((s) => s.title === "Autonomous" || s.phase === "auto")!;
    const { form, id } = insertFromForm(f, BIOBUZZ_FORM, { kind: "section", sectionId: sourceSection.id }, undefined, seq());
    const copy = section(form, id!);
    expect(copy.fields.length).toBe(sourceSection.fields.length);
    expect(copy.fields.map((x) => x.key)).toEqual(sourceSection.fields.map((x) => x.key));
    expect(copy.fields.map((x) => x.scoring)).toEqual(sourceSection.fields.map((x) => x.scoring));
    expect(copy.fields.every((x) => !sourceSection.fields.some((o) => o.id === x.id))).toBe(true);
    expect(parseForm(form).ok).toBe(true);
    expect(noErrors(form)).toEqual([]);
  });

  it("inserting the same category twice never duplicates a key", () => {
    let f = blank();
    const s = BIOBUZZ_FORM.sections.find((x) => x.phase === "teleop")!;
    f = insertFromForm(f, BIOBUZZ_FORM, { kind: "section", sectionId: s.id }, undefined, seq()).form;
    f = insertFromForm(f, BIOBUZZ_FORM, { kind: "section", sectionId: s.id }, undefined, seq()).form;
    expect(new Set(keys(f)).size).toBe(keys(f).length);
    expect(noErrors(f)).toEqual([]);
  });

  it("clones one group into a category, and one field, with its points", () => {
    const sourceSection = BIOBUZZ_FORM.sections.find((s) => s.groups?.length)!;
    const group = sourceSection.groups![0];
    const f = blank();
    const g = insertFromForm(f, BIOBUZZ_FORM, { kind: "group", sectionId: sourceSection.id, groupId: group.id }, "teleop", seq());
    expect(section(g.form, "teleop").groups![0].title).toBe(group.title);
    const inGroup = section(g.form, "teleop").fields.filter((x) => x.groupId === g.id);
    expect(inGroup.length).toBe(sourceSection.fields.filter((x) => x.groupId === group.id).length);
    expect(inGroup.every((x) => x.scoring && x.scoring.mode !== "none")).toBe(true);

    const field = sourceSection.fields.find((x) => x.scoring && x.scoring.mode !== "none")!;
    const one = insertFromForm(f, BIOBUZZ_FORM, { kind: "field", fieldId: field.id }, "endgame", seq());
    expect(findField(one.form, one.id!)!.field.scoring).toEqual(field.scoring);
    expect(insertFromForm(f, BIOBUZZ_FORM, { kind: "field", fieldId: "nope" }, "endgame").id).toBeNull();
    expect(insertFromForm(f, BIOBUZZ_FORM, { kind: "field", fieldId: field.id }, "missing").id).toBeNull();
    expect(insertFromForm(f, BIOBUZZ_FORM, { kind: "field", fieldId: BIOBUZZ_FORM.sections[0].fields[0].id }, "endgame").id).toBeNull(); // system field
  });

  it("remaps conditions among cloned fields and drops ones that would dangle", () => {
    let f = blank();
    f = addField(f, "teleop", defaultField(f, "toggle", "Gate"));
    const gate = section(f, "teleop").fields[0];
    f = addField(f, "teleop", { ...defaultField(f, "counter", "Gated"), visibleWhen: { fieldKey: gate.key, op: "checked" } });
    const src = section(f, "teleop").fields;
    const both = cloneFields(blank(), src);
    expect(both.fields[1].visibleWhen).toMatchObject({ fieldKey: both.fields[0].key });
    const lone = cloneFields(blank(), [src[1]]);
    expect(lone.fields[0].visibleWhen).toBeUndefined();
  });

  it("keeps a list of every key that ever existed", () => {
    expect(keysOf([BIOBUZZ_FORM]).has("autoLeave")).toBe(true);
    expect(allIds(blank()).has("pre-match")).toBe(true);
  });
});

describe("undo / redo history", () => {
  it("steps back and forward, and a new edit clears the redo stack", () => {
    let h = createHistory(1);
    h = pushHistory(h, 2, { now: 0 });
    h = pushHistory(h, 3, { now: 10_000 });
    expect([canUndo(h), canRedo(h)]).toEqual([true, false]);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe(2);
    h = pushHistory(h, 9, { now: 20_000 });
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([1, 2]);
  });

  it("ignores a no-op edit", () => {
    const h = createHistory({ a: 1 });
    expect(pushHistory(h, h.present)).toBe(h);
  });

  it("collapses a burst of edits to one thing into one undo step, but not across different things or long pauses", () => {
    let h = createHistory("");
    h = pushHistory(h, "a", { coalesceKey: "label", now: 0 });
    h = pushHistory(h, "ab", { coalesceKey: "label", now: 300 });
    h = pushHistory(h, "abc", { coalesceKey: "label", now: 600 });
    expect(h.past).toEqual([""]);
    h = pushHistory(h, "abcd", { coalesceKey: "help", now: 700 });
    expect(h.past).toEqual(["", "abc"]);
    h = pushHistory(h, "abcde", { coalesceKey: "help", now: 5000 });
    expect(h.past).toEqual(["", "abc", "abcd"]);
    h = undo(h);
    h = pushHistory(h, "x", { coalesceKey: "help", now: 5100 }); // right after an undo: a fresh step
    expect(h.past.at(-1)).toBe("abcd");
  });

  it("caps its memory", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = pushHistory(h, i, { now: i * 10_000 });
    expect(h.past.length).toBe(100);
    expect(h.past[0]).toBe(50);
  });
});

describe("diff between two versions", () => {
  const base = () => {
    let f = blank();
    f = addField(f, "teleop", { ...defaultField(f, "counter", "Samples"), scoring: { mode: "perTally", value: 3 } });
    f = addField(f, "teleop", defaultField(f, "toggle", "Parked"));
    return f;
  };
  const only = (f: Form, label: string) => section(f, "teleop").fields.find((x) => x.label === label)!;

  it("is empty for identical forms and reports nothing for a pure reorder", () => {
    const f = base();
    expect(diffForms(f, f).empty).toBe(true);
    const swapped = moveFieldBy(f, only(f, "Samples").id, 1);
    expect(diffForms(f, swapped).empty).toBe(true);
  });

  it("flags a points change as affecting scores, not data, and describes it", () => {
    const a = base();
    const b = updateField(a, only(a, "Samples").id, { scoring: { mode: "perTally", value: 5 } });
    const d = diffForms(a, b);
    expect(d.fields).toHaveLength(1);
    expect(d.fields[0].details).toEqual(["Points: 3 pts each → 5 pts each"]);
    expect(d.impact).toEqual({ scores: true, data: false });
  });

  it("flags a key change as affecting data, and says whether the alias keeps old entries readable", () => {
    const a = base();
    const noAlias = diffForms(a, setFieldKey(a, only(a, "Parked").id, "parkedFully"));
    expect(noAlias.impact.data).toBe(true);
    expect(noAlias.fields[0].details[0]).toMatch(/will NOT read/);
    const withAlias = diffForms(a, setFieldKey(a, only(a, "Parked").id, "parkedFully", new Set(["parked"])));
    expect(withAlias.fields[0].details[0]).toMatch(/still read/);
    expect(withAlias.impact.scores).toBe(false);
  });

  it("reports adds, removes and moves, with the right impact", () => {
    const a = base();
    const added = addField(a, "endgame", { ...defaultField(a, "toggle", "Climb"), scoring: { mode: "whenOn", value: 10 } });
    expect(diffForms(a, added)).toMatchObject({ fields: [{ kind: "added", impact: { scores: true, data: true } }], counts: { added: 1, removed: 0, changed: 0 } });
    const removed = removeField(a, only(a, "Parked").id);
    expect(diffForms(a, removed)).toMatchObject({ fields: [{ kind: "removed", impact: { scores: false, data: true } }] });
    const moved = moveField(a, only(a, "Samples").id, { sectionId: "endgame", index: 0 });
    const d = diffForms(a, moved);
    expect(d.fields[0]).toMatchObject({ kind: "moved", impact: { scores: true } });
    expect(d.fields[0].details[0]).toMatch(/Moved from "Teleoperated" to "Endgame"/);
  });

  it("covers options, ranges, conditions, categories and form-level changes", () => {
    let a = base();
    a = addField(a, "teleop", { ...defaultField(a, "select", "Where"), options: [{ value: "x", label: "X", points: 1 }, { value: "y", label: "Y", points: 2 }], scoring: { mode: "byOption" } });
    const where = only(a, "Where");
    const b1 = updateField(a, where.id, { options: [{ value: "x", label: "X", points: 4 }, { value: "z", label: "Z", points: 2 }] });
    const d1 = diffForms(a, b1);
    expect(d1.fields[0].details.join(" ")).toMatch(/Options added: z/);
    expect(d1.fields[0].details.join(" ")).toMatch(/Options removed: y/);
    expect(d1.fields[0].details.join(" ")).toMatch(/Option points changed: x/);
    expect(d1.impact).toEqual({ scores: true, data: true });

    const b2 = updateField(a, only(a, "Samples").id, { max: 9, visibleWhen: { fieldKey: only(a, "Parked").key, op: "checked" } });
    expect(diffForms(a, b2).fields[0].details).toEqual(expect.arrayContaining(["Max — → 9", "Visibility condition added"]));

    let b3 = updateSection(a, "teleop", { title: "Driver control", phase: "endgame", visible: false });
    b3 = { ...b3, name: "Pit 2", description: "x", tags: ["t"], scoringEnabled: false };
    const d3 = diffForms(a, b3);
    expect(d3.form).toEqual(expect.arrayContaining(['Name "Pit" → "Pit 2"', "Description changed", "Tags changed", "Scoring turned off (entries get no score or accuracy)"]));
    expect(d3.sections[0].details).toEqual(expect.arrayContaining(['Title "Teleoperated" → "Driver control"', "Phase teleop → endgame", "Now hidden from scouts"]));
    expect(d3.impact).toEqual({ scores: true, data: true });
  });

  it("ignores key order and undefined fields: a form that went through the validator or Firestore is the same form", () => {
    const parsed = parseForm(BIOBUZZ_FORM);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(diffForms(BIOBUZZ_FORM, parsed.form).empty).toBe(true);
    const roundTripped = JSON.parse(JSON.stringify(parsed.form)) as Form;
    expect(diffForms(BIOBUZZ_FORM, roundTripped).empty).toBe(true);
    const reordered: Form = { ...BIOBUZZ_FORM, sections: BIOBUZZ_FORM.sections.map((sec) => ({ ...sec, fields: sec.fields.map((x) => ({ ...x, analytics: x.analytics ? Object.fromEntries(Object.entries(x.analytics).reverse()) as typeof x.analytics : undefined })) })) };
    expect(diffForms(BIOBUZZ_FORM, reordered).empty).toBe(true);
  });

  it("describes scoring rules in words", () => {
    expect(describeScoring(undefined)).toBe("no points");
    expect(describeScoring({ mode: "whenOn", value: 2, cap: 4 })).toBe("2 pts when on (max 4)");
    expect(describeScoring({ mode: "perUnit", value: 1 })).toBe("1 pts per unit");
    expect(describeScoring({ mode: "byOption" })).toBe("points by option");
  });

  it("shows what an override changed from the built-in", () => {
    const edited = updateField(BIOBUZZ_FORM, BIOBUZZ_FORM.sections.flatMap((s) => s.fields).find((x) => x.key === "autoLeave")!.id, { scoring: { mode: "whenOn", value: 9 } });
    const d = diffForms(BIOBUZZ_FORM, edited);
    expect(d.fields.map((c) => c.key)).toEqual(["autoLeave"]);
    expect(d.impact.scores).toBe(true);
  });
});

describe("P22 helpers: permission, usage, creating forms, discarding drafts", () => {
  it("only the owner and admins manage forms", async () => {
    const { canManageForms } = await import("@/lib/forms/permissions");
    expect(canManageForms({ isAdmin: true })).toBe(true);
    expect(canManageForms({ isOwner: true })).toBe(true);
    expect(canManageForms({ isAdmin: false, isOwner: false })).toBe(false);
    expect(canManageForms({})).toBe(false);
    expect(canManageForms(null)).toBe(false);
  });

  it("counts entries per form and version; a form with entries can't be deleted", async () => {
    const { usageByForm, entryCount, canDeleteForm } = await import("@/lib/forms/usage");
    const u = usageByForm([{ formId: "a", formVersion: 1 }, { formId: "a", formVersion: 1 }, { formId: "a", formVersion: 2 }, { formId: "a" }, { formId: "b", formVersion: 1 }]);
    expect(u.get("a")).toMatchObject({ total: 4, unversioned: 1 });
    expect(u.get("a")!.byVersion.get(1)).toBe(2);
    expect(entryCount(u, "b")).toBe(1);
    expect(entryCount(u, "zzz")).toBe(0);
    expect(canDeleteForm(u, "a")).toBe(false);
    expect(canDeleteForm(u, "zzz")).toBe(true);
  });

  it("starts forms three ways, each custom, unique and unpublished", async () => {
    const { newFormFromScratch, duplicateAsNewForm, formFromImport } = await import("@/lib/forms/create");
    const { exportFormJson } = await import("@/lib/forms/portable");
    const taken = new Set(["biobuzz", "pit"]);
    const scratch = newFormFromScratch({ name: "Pit", taken, createdBy: "u1", now: 5 });
    expect(scratch).toMatchObject({ id: "pit-2", origin: "custom", version: 0, status: "draft", createdBy: "u1" });
    expect(scratch.sections.map((s) => s.title)).toEqual(["Pre-Match", "Autonomous", "Teleoperated", "Endgame", "Misc"]);
    const copy = duplicateAsNewForm(BIOBUZZ_FORM, { name: "BIOBUZZ", taken, createdBy: "u1" });
    expect(copy).toMatchObject({ id: "biobuzz-2", origin: "custom", version: 0, status: "draft" });
    expect(copy.baseBuiltInId).toBeUndefined();
    expect(copy.sections).toEqual(BIOBUZZ_FORM.sections);
    expect(copy.sections).not.toBe(BIOBUZZ_FORM.sections);
    const imported = formFromImport(exportFormJson(BIOBUZZ_FORM), { name: "", taken, createdBy: "u2" });
    expect(imported.ok && imported.form).toMatchObject({ id: "biobuzz-2", name: "BIOBUZZ", createdBy: "u2", origin: "custom" });
    expect(formFromImport("nope", { name: "x", taken, createdBy: "u" })).toMatchObject({ ok: false });
    expect(newFormFromScratch({ name: "  ", taken: new Set(), createdBy: "u" }).name).toBe("Untitled form");
  });

  it("discards a draft only when there is something to fall back to", async () => {
    const { createMemoryFormStore } = await import("@/lib/forms/store");
    const s = createMemoryFormStore({ actor: { uid: "a" } });
    const f = createBlankForm({ id: "x", name: "X", createdBy: "a" });
    await s.saveDraft({ ...f, scoringEnabled: false });
    await expect(s.discardDraft("x")).rejects.toMatchObject({ code: "invalid" }); // never published: archive instead
    await s.publish("x");
    await expect(s.discardDraft("x")).rejects.toMatchObject({ code: "no-draft" });
    await s.saveDraft({ ...f, name: "X2", scoringEnabled: false });
    await s.discardDraft("x");
    expect(await s.getDraft("x")).toBeNull();
    expect((await s.getForm("x"))?.name).toBe("X");
    // an override that was never published just goes back to the built-in
    await s.saveDraft({ ...BIOBUZZ_FORM, name: "Mine" });
    await s.discardDraft("biobuzz");
    expect(await s.getForm("biobuzz")).toBe(BIOBUZZ_FORM);
    expect((await s.listVersions("x")).map((v) => v.version)).toEqual([1]);
  });
});
