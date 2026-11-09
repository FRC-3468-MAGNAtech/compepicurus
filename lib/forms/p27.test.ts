import { describe, expect, it } from "vitest";
import { buildGameSchema } from "@/lib/analytics/game-schema";
import { entriesToCsv, parseImportCsv } from "@/lib/analytics/csv";
import { diffAgainstPlan, differenceSummary, expandFieldMap, findPlanEntry, plannedText, prefillFromPlan, sameValue, type PlanCandidate } from "@/lib/forms/compare";
import { addField, addGroup, defaultField, defaultTeamPicker, setFormCompareWith, setFormStickyNotes, setFormType, setGroupRepeat, updateField } from "@/lib/forms/edit";
import { createBlankForm, systemFieldsFor } from "@/lib/forms/new-form";
import { exportForm, importForm } from "@/lib/forms/portable";
import { hasRepeatGroup, maxRepeatSlots, parseSlotKey, slotCountFor, slotKey, valueSlots } from "@/lib/forms/repeat";
import { addStep, canAddStep, countSteps, isMovable, moveStep, normalizeSequence, parseSequenceSummary, removeStep, summarizeSequence } from "@/lib/forms/sequence";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";
import { coerceFieldValue, defaultValues, isAnswered, matrixCells, normalizeValues, validateValues } from "@/lib/forms/values";
import { REQUIRED_SYSTEM_FIELDS, FORM_TYPES, type Form, type FormField, type FormType, type FormValues, type SequenceStep } from "@/lib/forms/types";
import { derivedComments, entryPayloadFor, type ScoutEntry } from "@/lib/scout-entries";
import { calculateScore } from "@/lib/forms/scoring";

// P27: the new field types, per-team groups, plan comparison, sticky notes, and what they do to analytics and CSV.

const STEPS: SequenceStep[] = [
  { id: "start", label: "Start", maxCount: 1, pin: "first" },
  { id: "hive", label: "Hive", maxCount: 0, pin: null },
  { id: "flower", label: "Flower", maxCount: 0, pin: null },
  { id: "bonus", label: "Bonus", maxCount: 1, pin: null },
  { id: "park", label: "Park", maxCount: 1, pin: "last" },
];

/** A blank form of a type with one field of each new kind in Misc. */
function formWith(formType: FormType, build: (f: Form) => Form = (x) => x): Form {
  let f = createBlankForm({ id: "t", name: "T", createdBy: "u", formType });
  f = build(f);
  return f;
}
const add = (f: Form, type: Parameters<typeof defaultField>[1], label: string, patch: Partial<FormField> = {}, section = "misc"): Form => {
  const field = { ...defaultField(f, type, label), ...patch };
  return addField(f, section, field);
};
const errors = (f: Form) => blockingIssues(checkForm(f)).map((i) => i.code);

describe("form types and their required system fields", () => {
  it("a blank form of each type carries exactly the pickers it needs, and is valid", () => {
    for (const t of FORM_TYPES) {
      const f = createBlankForm({ id: "x", name: "X", createdBy: "u", formType: t });
      expect(f.sections[0].fields.map((x) => x.type).sort()).toEqual([...REQUIRED_SYSTEM_FIELDS[t]].sort());
      expect(parseForm(f).ok, t).toBe(true);
      expect(errors(f), t).toEqual(t === "match-scout" ? ["scoring-empty"] : []);
    }
    expect(createBlankForm({ id: "x", name: "X", createdBy: "u", formType: "pit-scout" }).scoringEnabled).toBe(false);
    expect(createBlankForm({ id: "x", name: "X", createdBy: "u" }).scoringEnabled).toBe(true);
  });

  it("a missing or duplicated required picker is a blocking error; an extra optional one is fine", () => {
    let f = formWith("lead-scout");
    f = { ...f, sections: f.sections.map((s) => ({ ...s, fields: s.fields.filter((x) => x.type !== "alliancePicker") })) };
    expect(errors(f)).toContain("missing-system-field");
    f = formWith("pit-scout");
    expect(errors(setFormType(f, "lead-scout"))).toEqual([]); // switching adds the pickers the new type needs
    expect(setFormType(f, "lead-scout").sections[0].fields.map((x) => x.type)).toEqual(expect.arrayContaining(["eventPicker", "matchPicker", "alliancePicker", "teamPicker", "scoutName"]));
    const dup = { ...f, sections: f.sections.map((s) => (s.id === "pre-match" ? { ...s, fields: [...s.fields, { ...s.fields[0], id: "dup" }] } : s)) };
    expect(errors(dup)).toContain("duplicate-system-field");
  });

  it("a team picker under another key is an ordinary field inside a per-team group, and an error anywhere else", () => {
    const f = formWith("lead-scout", (x) => {
      const g = addGroup(x, "misc", "Teams");
      let y = setGroupRepeat(g.form, "misc", g.id!, { source: "allianceTeams", maxSlots: 3 });
      y = addField(y, "misc", defaultTeamPicker(y, "Team"), { groupId: g.id! });
      return y;
    });
    expect(errors(f)).toEqual([]);
    const loose = formWith("lead-scout", (x) => addField(x, "misc", defaultTeamPicker(x, "Team")));
    expect(errors(loose)).toContain("team-picker-key");
  });
});

describe("slider", () => {
  const field = { ...defaultField(createBlankForm({ id: "a", name: "A", createdBy: "u" }), "slider", "Skill"), min: 1, max: 5, step: 1 };

  it("coerces to an integer on the step grid inside the range", () => {
    expect(coerceFieldValue(field, 3)).toBe(3);
    expect(coerceFieldValue(field, 0)).toBe(1);
    expect(coerceFieldValue(field, 99)).toBe(5);
    expect(coerceFieldValue(field, 2.6)).toBe(3);
    expect(coerceFieldValue(field, "4")).toBe(4);
    expect(coerceFieldValue(field, "nope")).toBe(1);
    expect(coerceFieldValue({ ...field, min: 0, max: 10, step: 5 }, 7)).toBe(5);
    expect(coerceFieldValue({ ...field, min: 0, max: 10, step: 5 }, 8)).toBe(10);
  });

  it("is always answered, and checkForm enforces a whole-number range with a step", () => {
    expect(isAnswered(field, 1)).toBe(true);
    const f = (patch: Partial<FormField>) => formWith("custom", (x) => add(x, "slider", "S", patch));
    expect(errors(f({ min: 5, max: 1 }))).toContain("slider-range");
    expect(errors(f({ min: 1, max: 5, step: 0 }))).toContain("slider-step");
    expect(errors(f({ min: 0, max: 1000, step: 1 }))).toContain("slider-steps");
    expect(errors(f({ min: 1, max: 10, step: 1 }))).toEqual([]);
  });
});

describe("sequence", () => {
  it("appends, forces pinned steps to the ends, and enforces once-only steps", () => {
    let seq: string[] = [];
    seq = addStep(STEPS, seq, "hive");
    seq = addStep(STEPS, seq, "start"); // pinned first goes to the front though added later
    seq = addStep(STEPS, seq, "park");
    seq = addStep(STEPS, seq, "flower"); // a middle step goes before the pinned-last one
    expect(seq).toEqual(["start", "hive", "flower", "park"]);
    expect(addStep(STEPS, seq, "start")).toEqual(seq); // once only
    expect(addStep(STEPS, seq, "hive")).toEqual(["start", "hive", "flower", "hive", "park"]); // unlimited
    expect(canAddStep(STEPS, seq, "park")).toBe(false);
    expect(canAddStep(STEPS, seq, "nope")).toBe(false);
    expect(canAddStep(STEPS, seq, "bonus")).toBe(true);
  });

  it("only the middle steps move, and only within the middle", () => {
    const seq = ["start", "hive", "flower", "bonus", "park"];
    expect(isMovable(STEPS, seq, 0)).toBe(false);
    expect(isMovable(STEPS, seq, 4)).toBe(false);
    expect(isMovable(STEPS, seq, 2)).toBe(true);
    expect(moveStep(STEPS, seq, 3, 1)).toEqual(["start", "bonus", "hive", "flower", "park"]);
    expect(moveStep(STEPS, seq, 1, 99)).toEqual(["start", "flower", "bonus", "hive", "park"]); // clamped inside the middle
    expect(moveStep(STEPS, seq, 3, 0)).toEqual(["start", "bonus", "hive", "flower", "park"]); // can't go before the pinned start
    expect(moveStep(STEPS, seq, 0, 2)).toEqual(seq); // a pinned step doesn't move
    expect(moveStep(STEPS, seq, 4, 1)).toEqual(seq);
    expect(removeStep(seq, 2)).toEqual(["start", "hive", "bonus", "park"]);
  });

  it("normalizes whatever is stored: unknown ids dropped, duplicates of once-only steps collapsed, pins enforced", () => {
    expect(normalizeSequence(STEPS, ["hive", "zzz", "park", "start", "bonus", "bonus", "start", 5, "park"])).toEqual(["start", "hive", "bonus", "park"]);
    expect(coerceFieldValue({ ...defaultField(formWith("custom"), "sequence", "S"), steps: STEPS }, ["hive", "start"])).toEqual(["start", "hive"]);
    expect(coerceFieldValue({ ...defaultField(formWith("custom"), "sequence", "S"), steps: STEPS }, "nope")).toEqual([]);
  });

  it("summarizes, counts every step, and reads a summary back", () => {
    const seq = ["start", "hive", "hive", "park"];
    expect(summarizeSequence(STEPS, seq)).toBe("Start → Hive → Hive → Park");
    expect(countSteps(STEPS, seq)).toEqual({ start: 1, hive: 2, flower: 0, bonus: 0, park: 1 });
    expect(parseSequenceSummary(STEPS, "Start → Hive → Hive → Park")).toEqual(seq);
    expect(parseSequenceSummary(STEPS, "start → HIVE → Mystery → park")).toEqual(["start", "hive", "park"]);
  });

  it("checkForm needs two steps, unique ids, at most one pin each way, pinned steps used once", () => {
    const f = (steps: SequenceStep[]) => formWith("custom", (x) => add(x, "sequence", "S", { steps }));
    expect(errors(f([STEPS[1]]))).toContain("sequence-steps");
    expect(errors(f([STEPS[1], { ...STEPS[1] }]))).toContain("sequence-duplicate");
    expect(errors(f([STEPS[0], { ...STEPS[0], id: "start2" }, STEPS[1]]))).toContain("sequence-pins");
    expect(errors(f([{ ...STEPS[0], maxCount: 0 }, STEPS[1]]))).toContain("sequence-pinned-once");
    expect(errors(f(STEPS))).toEqual([]);
  });
});

describe("matrix", () => {
  const matrix: FormField = {
    ...defaultField(formWith("custom"), "matrix", "Moves"),
    rows: [
      { key: "leave", label: "Leave" },
      { key: "park", label: "Park" },
    ],
    cols: [
      { key: "auto", label: "Auto" },
      { key: "end", label: "Endgame" },
    ],
    disabledCells: ["leave_end"],
  };

  it("offers every cell except the disabled ones, stored as one boolean per row_col", () => {
    expect(matrixCells(matrix)).toEqual(["leave_auto", "park_auto", "park_end"]);
    expect(coerceFieldValue(matrix, { leave_auto: true, leave_end: true, nope: true, park_end: "yes" })).toEqual({ leave_auto: true, park_auto: false, park_end: false });
    expect(isAnswered(matrix, { leave_auto: false })).toBe(false);
    expect(isAnswered(matrix, { leave_auto: true })).toBe(true);
  });

  it("checkForm: axes, unique keys, no ambiguous cells, real disabled cells, not all disabled", () => {
    const f = (patch: Partial<FormField>) => formWith("custom", (x) => add(x, "matrix", "M", { ...matrix, ...patch }));
    expect(errors(f({}))).toEqual([]);
    expect(errors(f({ rows: [] }))).toContain("matrix-axes");
    expect(errors(f({ rows: [matrix.rows![0], { ...matrix.rows![0] }] }))).toContain("matrix-duplicate");
    expect(errors(f({ rows: [{ key: "a_b", label: "AB" }, { key: "a", label: "A" }], cols: [{ key: "c", label: "C" }, { key: "b_c", label: "BC" }] }))).toContain("matrix-ambiguous");
    expect(errors(f({ disabledCells: ["ghost_cell"] }))).toContain("matrix-disabled");
    expect(errors(f({ disabledCells: ["leave_auto", "leave_end", "park_auto", "park_end"] }))).toContain("matrix-empty");
  });
});

describe("photos (image)", () => {
  const field = { ...defaultField(formWith("custom"), "image", "Robot"), maxCount: 2 };
  const photo = (n: number) => ({ url: `https://abc.public.blob.vercel-storage.com/pit/t/e/1/x${n}.jpg`, pathname: `pit/t/e/1/x${n}.jpg`, size: 1000, contentType: "image/jpeg" });

  it("keeps well-formed https photos up to the maximum, drops the rest", () => {
    expect(coerceFieldValue(field, [photo(1), photo(2), photo(3)])).toEqual([photo(1), photo(2)]);
    expect(coerceFieldValue(field, [{ url: "http://insecure.example/x.jpg" }, { url: "javascript:alert(1)" }, null, 5, photo(1)])).toEqual([photo(1)]);
    expect(coerceFieldValue(field, "nope")).toEqual([]);
    expect(coerceFieldValue({ ...field, maxCount: undefined }, [photo(1), photo(2)])).toHaveLength(1);
  });

  it("is answered when it has a photo", () => {
    expect(isAnswered(field, [])).toBe(false);
    expect(isAnswered(field, [photo(1)])).toBe(true);
  });
});

describe("per-team repeating groups", () => {
  const form = () =>
    formWith("lead-scout", (x) => {
      const g = addGroup(x, "misc", "Teams");
      let y = setGroupRepeat(g.form, "misc", g.id!, { source: "allianceTeams", maxSlots: 3 });
      y = addField(y, "misc", defaultTeamPicker(y, "Team"), { groupId: g.id! });
      y = addField(y, "misc", { ...defaultField(y, "textarea", "Notes"), key: "notes", required: true }, { groupId: g.id! });
      y = addField(y, "misc", { ...defaultField(y, "slider", "Skill"), key: "skill" }, { groupId: g.id! });
      return y;
    });

  it("stores each field by slot and builds defaults for every slot", () => {
    const f = form();
    expect(valueSlots(f).map((s) => s.storageKey)).toEqual(expect.arrayContaining(["t1_team", "t2_team", "t3_team", "t1_notes", "t3_skill"]));
    expect(valueSlots(f).filter((s) => s.slot !== null)).toHaveLength(9);
    const d = defaultValues(f);
    expect(d.t1_notes).toBe("");
    expect(d.t2_skill).toBe(1);
    expect(d.t3_team).toBe("");
    expect(slotKey(2, "notes")).toBe("t2_notes");
    expect(parseSlotKey("t2_notes")).toEqual({ slot: 2, key: "notes" });
    expect(parseSlotKey("notes")).toBeNull();
    expect(hasRepeatGroup(f)).toBe(true);
    expect(maxRepeatSlots(f)).toBe(3);
  });

  it("draws 2 boxes for a qualification alliance and up to 3 for a playoff one", () => {
    expect(slotCountFor(2, 3)).toBe(2);
    expect(slotCountFor(3, 3)).toBe(3);
    expect(slotCountFor(5, 3)).toBe(3);
    expect(slotCountFor(0, 3)).toBe(1);
  });

  it("normalizes slots, and requires fields only for the slots shown", () => {
    const f = form();
    const v = normalizeValues(f, { t1_team: "1111", t1_notes: "fast", t2_team: 2222, t2_skill: 4, t9_notes: "stray" });
    expect(v.t1_team).toBe(1111);
    expect(v.t2_skill).toBe(4);
    expect("t9_notes" in v).toBe(false);
    // required notes: 2 teams shown, the third slot isn't asked for
    const errs = validateValues(f, v, { slotCount: 2 });
    expect(Object.keys(errs)).toEqual(["t2_notes"]);
    expect(errs.t2_notes).toBe("Notes (team 2) is required.");
    expect(Object.keys(validateValues(f, v)).sort()).toEqual(["t2_notes", "t3_notes"]);
  });

  it("a group field can't score, be conditional, carry roles, or need a missing alliance picker; keys can't collide with slot keys", () => {
    const f = form();
    const notes = f.sections.flatMap((s) => s.fields).find((x) => x.key === "notes")!;
    expect(errors(updateField(f, notes.id, (x) => ({ ...x, scoring: { mode: "perUnit", value: 1 } })))).toContain("repeat-scoring");
    expect(errors(updateField(f, notes.id, (x) => ({ ...x, visibleWhen: { fieldKey: "skill", op: "gt", value: 1 } })))).toContain("repeat-conditional");
    expect(errors(updateField(f, notes.id, (x) => ({ ...x, statRoles: ["comments"] })))).toContain("repeat-roles");
    const noAlliance = { ...f, sections: f.sections.map((s) => ({ ...s, fields: s.fields.filter((x) => x.type !== "alliancePicker") })) };
    expect(errors(noAlliance)).toEqual(expect.arrayContaining(["repeat-needs-alliance", "missing-system-field"]));
    expect(errors(add(f, "text", "Collide", { key: "t1_notes" }))).toContain("repeat-key-collision");
    expect(errors(f)).toEqual([]);
  });

  it("slot keys follow key aliases", () => {
    const f = { ...form(), keyAliases: { remarks: "notes" } };
    expect(normalizeValues(f, { t1_remarks: "old" }).t1_notes).toBe("old");
  });
});

describe("plan versus actual (compareWith)", () => {
  const plan = (over: Partial<PlanCandidate> = {}): PlanCandidate => ({ id: "p1", formId: "match-strategy-v1", eventCode: "EVT", matchKey: "Q5", alliance: "red", createdAtMs: 100, values: { t1_role: "hive", t1_auto: true, t2_role: "flower", t2_auto: false }, ...over });
  const compare = { formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"] as ("eventCode" | "matchKey" | "alliance")[], fieldMap: { role: "role", auto: "auto" } };
  const reflection = () =>
    formWith("drive-reflection", (x) => {
      const g = addGroup(x, "misc", "Teams");
      let y = setGroupRepeat(g.form, "misc", g.id!, { source: "allianceTeams", maxSlots: 3 });
      y = addField(y, "misc", { ...defaultField(y, "select", "Role"), key: "role", options: [{ value: "hive", label: "Hive" }, { value: "flower", label: "Flower" }] }, { groupId: g.id! });
      y = addField(y, "misc", { ...defaultField(y, "checkbox", "Auto"), key: "auto" }, { groupId: g.id! });
      return setFormCompareWith(y, compare);
    });

  it("finds the latest plan for the same event, match and alliance", () => {
    const entries = [plan(), plan({ id: "p2", createdAtMs: 300 }), plan({ id: "p3", createdAtMs: 200 }), plan({ id: "other-match", matchKey: "Q6", createdAtMs: 999 }), plan({ id: "blue", alliance: "blue", createdAtMs: 999 }), plan({ id: "other-form", formId: "x", createdAtMs: 999 })];
    expect(findPlanEntry(entries, compare, { eventCode: "EVT", matchKey: "Q5", alliance: "red" })?.id).toBe("p2");
    expect(findPlanEntry(entries, compare, { eventCode: "EVT", matchKey: "Q5", alliance: "blue" })?.id).toBe("blue");
    expect(findPlanEntry(entries, compare, { eventCode: "EVT", matchKey: "Q5", alliance: null })).toBeNull(); // not chosen yet
    expect(findPlanEntry(entries, compare, { eventCode: "OTHER", matchKey: "Q5", alliance: "red" })).toBeNull();
    expect(findPlanEntry([], compare, { eventCode: "EVT", matchKey: "Q5", alliance: "red" })).toBeNull();
    // a looser match
    expect(findPlanEntry(entries, { formId: "match-strategy-v1", matchOn: ["matchKey"] }, { matchKey: "Q6" })?.id).toBe("other-match");
  });

  it("expands the field map per slot for a repeating group", () => {
    const f = reflection();
    expect(expandFieldMap(f, compare.fieldMap, 2)).toEqual([
      { key: "t1_role", planKey: "t1_role" },
      { key: "t2_role", planKey: "t2_role" },
      { key: "t1_auto", planKey: "t1_auto" },
      { key: "t2_auto", planKey: "t2_auto" },
    ]);
    expect(expandFieldMap(f, { ghost: "x" }, 2)).toEqual([]);
  });

  it("prefills from the plan without overwriting what the person edited, and follows a changed plan", () => {
    const pairs = expandFieldMap(reflection(), compare.fieldMap, 2);
    let values: FormValues = { t1_role: "", t1_auto: false, t2_role: "", t2_auto: false };
    values = prefillFromPlan(pairs, values, plan().values, new Set());
    expect(values).toMatchObject({ t1_role: "hive", t1_auto: true, t2_role: "flower", t2_auto: false });
    // the person changes slot 1's role; the plan then changes: only untouched answers follow
    const edited: FormValues = { ...values, t1_role: "flower" };
    const touched = new Set(["t1_role"]);
    const changed = prefillFromPlan(pairs, edited, { ...plan().values, t1_role: "hive", t2_role: "hive" }, touched);
    expect(changed).toMatchObject({ t1_role: "flower", t2_role: "hive" });
    expect(prefillFromPlan(pairs, changed, { ...plan().values, t1_role: "hive", t2_role: "hive" }, touched)).toBe(changed); // nothing to change: same object
  });

  it("marks every answer that differs, with 'Planned: Hive' and a count", () => {
    const f = reflection();
    const pairs = expandFieldMap(f, compare.fieldMap, 2);
    const values = { t1_role: "hive", t1_auto: false, t2_role: "hive", t2_auto: false } as never;
    const diffs = diffAgainstPlan(pairs, values, plan().values);
    expect(diffs.map((d) => d.key)).toEqual(["t2_role", "t1_auto"]);
    const role = f.sections.flatMap((s) => s.fields).find((x) => x.key === "role");
    expect(plannedText(role, diffs[0].planned)).toBe("Planned: Flower");
    expect(plannedText(undefined, true)).toBe("Planned: Yes");
    expect(plannedText(undefined, false)).toBe("Planned: No");
    expect(plannedText(undefined, "")).toBe("Planned: nothing");
    expect(differenceSummary(diffs.length)).toBe("2 differences from plan");
    expect(differenceSummary(1)).toBe("1 difference from plan");
    expect(differenceSummary(0)).toBe("Matches the plan");
  });

  it("a key the plan never answered is not a difference; values compare by content", () => {
    expect(diffAgainstPlan([{ key: "a", planKey: "a" }], { a: "x" }, {})).toEqual([]);
    expect(sameValue("", undefined)).toBe(true);
    expect(sameValue(false, undefined)).toBe(true);
    expect(sameValue(3, "3")).toBe(true);
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue({ x: true, y: false }, { x: true })).toBe(true);
    expect(sameValue({ x: true }, { x: false })).toBe(false);
  });

  it("checkForm: matching parts need their pickers, mapped fields must exist", () => {
    const f = reflection();
    expect(errors(f)).toEqual([]);
    expect(errors(setFormCompareWith(f, { ...compare, fieldMap: { role: "role", ghost: "x" } }))).toContain("compare-field-missing");
    const noMatch = { ...f, sections: f.sections.map((s) => ({ ...s, fields: s.fields.filter((x) => x.type !== "matchPicker") })) };
    expect(errors(noMatch)).toContain("compare-needs-picker");
  });
});

describe("sticky notes setting and the derived comments", () => {
  it("is a setting with a default-open flag that can't be set while off", () => {
    const f = formWith("custom");
    expect(setFormStickyNotes(f, { enabled: true, defaultOpen: true }).stickyNotes).toEqual({ enabled: true, defaultOpen: true });
    expect(setFormStickyNotes(f, { enabled: false, defaultOpen: true }).stickyNotes).toEqual({ enabled: false, defaultOpen: false });
    expect(setFormStickyNotes(setFormStickyNotes(f, { enabled: true, defaultOpen: false }), null).stickyNotes).toBeUndefined();
  });

  it("joins the notes with ' | ' into the summary comment, after the comments field, and is unchanged without notes", () => {
    const f = createBlankForm({ id: "x", name: "X", createdBy: "u" });
    const notes = [
      { id: "1", text: "Slow auto", color: "yellow", createdAt: 1 },
      { id: "2", text: "  ", color: "yellow", createdAt: 2 },
      { id: "3", text: "Great defense", color: "blue", createdAt: 3 },
    ];
    expect(derivedComments(f, { comments: "Overall fine" }, notes)).toBe("Overall fine | Slow auto | Great defense");
    expect(derivedComments(f, { comments: "" }, notes)).toBe("Slow auto | Great defense");
    expect(derivedComments(f, { comments: "Overall fine" })).toBe("Overall fine");
    expect(derivedComments(f, { comments: "Overall fine" }, [])).toBe("Overall fine");
    const payload = entryPayloadFor(f, { comments: "x" }, calculateScore(f, { comments: "x" }), { stickyNotes: notes });
    expect(payload.stickyNotes).toHaveLength(3);
    expect(payload.comments).toBe("x | Slow auto | Great defense");
    expect(entryPayloadFor(f, { comments: "x" }, calculateScore(f, { comments: "x" })).stickyNotes).toBeUndefined();
  });
});

// a match-scout form that also carries an alliance picker (a per-team group needs one to know which teams to draw)
const withAlliance = (f: Form): Form => ({ ...f, sections: f.sections.map((s) => (s.id === "pre-match" ? { ...s, fields: [...s.fields, systemFieldsFor("lead-scout").find((x) => x.type === "alliancePicker")!] } : s)) });

describe("analytics columns and CSV for the new fields", () => {
  const build = () =>
    formWith("match-scout", (x) => {
      let y = add(withAlliance(x), "slider", "Skill", { key: "skill" });
      y = add(y, "sequence", "Cycle", { key: "cycle", steps: STEPS });
      y = add(y, "matrix", "Moves", { key: "moves", rows: [{ key: "leave", label: "Leave" }, { key: "park", label: "Park" }], cols: [{ key: "auto", label: "Auto" }, { key: "end", label: "End" }], disabledCells: ["leave_end"] });
      y = add(y, "image", "Photos", { key: "photos", maxCount: 3 });
      const g = addGroup(y, "misc", "Teams");
      y = setGroupRepeat(g.form, "misc", g.id!, { source: "allianceTeams", maxSlots: 2 });
      y = addField(y, "misc", { ...defaultField(y, "textarea", "Remarks"), key: "remarks" }, { groupId: g.id! });
      y = setFormStickyNotes(y, { enabled: true, defaultOpen: false });
      // scoring on a counter so the form is valid
      y = add(y, "counter", "Hive", { key: "hive", scoring: { mode: "perTally", value: 2 } });
      return y;
    });
  const photo = { url: "https://s.public.blob.vercel-storage.com/pit/t/e/1/a.jpg", pathname: "pit/t/e/1/a.jpg", size: 10, contentType: "image/jpeg" };
  const entry = (form: Form, values: Record<string, unknown>, extra: Partial<ScoutEntry> = {}): ScoutEntry => {
    const v = normalizeValues(form, values);
    return { id: "e1", teamId: "t", uid: "u", source: "event", mode: null, formId: form.id, formVersion: 1, scoutName: "Ada", eventCode: "EVT", matchType: "Qualification", matchNumber: 5, teamNumber: 254, values: v, score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, comments: "", submittedAt: "", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: null, libraryMatchId: null, ...extra } as ScoutEntry;
  };

  it("the form is valid and its table has the right columns", () => {
    const form = build();
    expect(errors(form)).toEqual([]);
    const cols = buildGameSchema(form).columns;
    const labels = cols.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Skill", "Cycle", "Photos", "Photos (photos)", "Cycle: Hive (count)", "Cycle: Bonus (count)", "Remarks (team 1)", "Remarks (team 2)", "Notes"]));
    // one boolean column per enabled matrix cell (the disabled one is absent)
    expect(cols.filter((c) => c.key.startsWith("moves__")).map((c) => c.label)).toEqual(["Moves: Leave / Auto", "Moves: Park / Auto", "Moves: Park / End"]);
    expect(cols.find((c) => c.label === "Notes")?.type).toBe("notes");
    expect(cols.find((c) => c.label === "Photos")?.type).toBe("photos");
    expect(cols.find((c) => c.key === "skill")?.type).toBe("count");
  });

  it("cells read the stored values", () => {
    const form = build();
    const cols = buildGameSchema(form).columns;
    const e = entry(form, { skill: 4, cycle: ["start", "hive", "hive", "park"], moves: { leave_auto: true, park_end: true }, photos: [photo], t1_remarks: "quick", t2_remarks: "slow" }, { stickyNotes: [{ id: "1", text: "n1", color: "y", createdAt: 1 }, { id: "2", text: "n2", color: "y", createdAt: 2 }] });
    const cell = (label: string) => cols.find((c) => c.label === label)!.getValue(e);
    expect(cell("Skill")).toBe(4);
    expect(cell("Cycle")).toBe("Start → Hive → Hive → Park");
    expect(cell("Cycle: Hive (count)")).toBe(2);
    expect(cell("Cycle: Flower (count)")).toBe(0);
    expect(cell("Moves: Leave / Auto")).toBe(true);
    expect(cell("Moves: Park / Auto")).toBe(false);
    expect(cell("Moves: Park / End")).toBe(true);
    expect(cell("Photos")).toBe(photo.url);
    expect(cell("Photos (photos)")).toBe(1);
    expect(cell("Remarks (team 1)")).toBe("quick");
    expect(cell("Remarks (team 2)")).toBe("slow");
    expect(cell("Notes")).toBe("n1 | n2");
  });

  it("CSV exports a column per cell/slot/step, and importing it gives the same values (derived columns are never imported)", () => {
    const form = build();
    const schema = buildGameSchema(form);
    const e = entry(form, { skill: 4, cycle: ["start", "hive", "hive", "park"], moves: { leave_auto: true, park_end: true }, photos: [photo], t1_remarks: "quick", t2_remarks: "", hive: 3 }, { stickyNotes: [{ id: "1", text: "n1", color: "y", createdAt: 1 }] });
    const csv = entriesToCsv(schema, [e], (n) => n);
    const header = csv.split("\r\n")[0];
    expect(header).toContain("Misc - Misc - Moves: Park / End");
    expect(header).toContain("Cycle: Hive (count)");
    expect(header).toContain("Notes");
    const result = parseImportCsv(schema, csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const imported = normalizeValues(form, result.rows[0].values);
    expect(imported).toEqual(normalizeValues(form, e.values as Record<string, unknown>) && imported); // shape check below
    expect(imported.skill).toBe(4);
    expect(imported.cycle).toEqual(["start", "hive", "hive", "park"]);
    expect(imported.moves).toEqual({ leave_auto: true, park_auto: false, park_end: true });
    expect((imported.photos as { url: string }[])[0].url).toBe(photo.url);
    expect(imported.t1_remarks).toBe("quick");
    expect(imported.hive).toBe(3);
    // the full round trip is exact for everything except photo metadata, which a CSV can't carry
    const exact = { ...(e.values as Record<string, unknown>) };
    delete exact.photos;
    const back = { ...imported } as Record<string, unknown>;
    delete back.photos;
    expect(back).toEqual(exact);
  });
});

describe("portable forms carry the new settings", () => {
  it("exports and imports a form with every new feature unchanged", () => {
    let f = formWith("drive-reflection", (x) => {
      const g = addGroup(x, "misc", "Teams");
      let y = setGroupRepeat(g.form, "misc", g.id!, { source: "allianceTeams", maxSlots: 3 });
      y = addField(y, "misc", { ...defaultField(y, "select", "Role"), key: "role", options: [{ value: "hive", label: "Hive" }, { value: "flower", label: "Flower" }] }, { groupId: g.id! });
      y = add(y, "sequence", "Cycle", { key: "cycle", steps: STEPS });
      y = add(y, "matrix", "Moves", { key: "moves" });
      y = add(y, "image", "Photos", { key: "photos", maxCount: 2 });
      y = add(y, "slider", "Skill", { key: "skill", endLabels: { min: "Low", max: "High" } });
      y = setFormStickyNotes(y, { enabled: true, defaultOpen: true });
      return setFormCompareWith(y, { formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: { role: "role" } });
    });
    f = { ...f, scoringEnabled: false };
    expect(errors(f)).toEqual([]);
    const out = exportForm(f);
    const back = importForm(JSON.parse(JSON.stringify(out)));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.form.formType).toBe("drive-reflection");
      expect(back.form.stickyNotes).toEqual({ enabled: true, defaultOpen: true });
      expect(back.form.compareWith?.fieldMap).toEqual({ role: "role" });
      const fields = back.form.sections.flatMap((s) => s.fields);
      expect(fields.find((x) => x.key === "cycle")?.steps).toEqual(STEPS);
      expect(fields.find((x) => x.key === "photos")?.maxCount).toBe(2);
      expect(back.form.sections.flatMap((s) => s.groups ?? []).find((g) => g.repeat)?.repeat).toEqual({ source: "allianceTeams", maxSlots: 3 });
    }
  });

  it("the strict parser refuses malformed new settings", () => {
    const f = formWith("custom", (x) => add(x, "sequence", "S", { steps: STEPS }));
    const bad = (mutate: (o: Record<string, unknown>) => void) => {
      const o = JSON.parse(JSON.stringify(f));
      mutate(o);
      return parseForm(o).ok;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((o) => ((o.sections as { fields: { steps?: { pin: string }[] }[] }[])[4].fields.find((x) => x.steps)!.steps![0].pin = "middle"))).toBe(false);
    expect(bad((o) => (o.formType = "nope"))).toBe(false);
    expect(bad((o) => (o.stickyNotes = { enabled: true }))).toBe(false);
    expect(bad((o) => (o.compareWith = { formId: "x", matchOn: [], fieldMap: {} }))).toBe(false);
    expect(bad((o) => (o.compareWith = { formId: "x", matchOn: ["eventCode"], fieldMap: { "bad key": "x" } }))).toBe(false);
  });
});

describe("forms that don't score", () => {
  it("score zero, mark entries unscored, and show no score or accuracy columns", () => {
    const f = formWith("pit-scout", (x) => add(x, "slider", "Build quality", { key: "build" }));
    expect(f.scoringEnabled).toBe(false);
    const score = calculateScore(f, normalizeValues(f, { build: 5 }));
    expect(score.total).toBe(0);
    expect(entryPayloadFor(f, normalizeValues(f, { build: 5 }), score).scored).toBe(false);
    const labels = buildGameSchema(f).columns.map((c) => c.label);
    expect(labels).not.toContain("Alliance Accuracy");
    expect(labels).not.toContain("Total");
    expect(labels).toContain("Build quality");
  });
});
