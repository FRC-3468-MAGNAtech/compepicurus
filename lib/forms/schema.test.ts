import { describe, expect, it } from "vitest";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { createBlankForm } from "@/lib/forms/new-form";
import { checkForm, parseForm, blockingIssues, FORM_LIMITS } from "@/lib/forms/validate";
import { calculateScore, fieldPoints, maxScore, storableScore } from "@/lib/forms/scoring";
import { conditionHolds, visibleFieldKeys } from "@/lib/forms/visibility";
import { applyAliases, coerceFieldValue, commentsFrom, defaultValues, normalizeValues, resolveAlias, validateValues } from "@/lib/forms/values";
import { STANDARD_PHASES, type Form, type FormField } from "@/lib/forms/types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const field = (over: Partial<FormField> & Pick<FormField, "key" | "type">): FormField => ({ id: `f-${over.key}`, label: over.key, ...over });

/** A scratch form: the five default phases, locked system fields, with `fields` added to the teleop category. */
function formWith(fields: FormField[], over: Partial<Form> = {}): Form {
  const form = createBlankForm({ id: "scratch", name: "Scratch", createdBy: "u1" });
  form.sections.find((s) => s.id === "teleop")!.fields.push(...fields);
  return { ...form, ...over };
}
const codes = (f: Form) => checkForm(f).map((i) => i.code);

describe("schema v2: parseForm (structure)", () => {
  it("accepts the BIOBUZZ built-in and a blank new form", () => {
    expect(parseForm(BIOBUZZ_FORM).ok).toBe(true);
    expect(parseForm(createBlankForm({ id: "x", name: "X", createdBy: "u" })).ok).toBe(true);
  });

  it("rejects unknown field types and unknown keys anywhere", () => {
    const bad = formWith([field({ key: "a", type: "toggle" })]);
    (bad.sections[2].fields[0] as unknown as { type: string }).type = "hologram";
    expect(parseForm(bad).ok).toBe(false);
    const extra = clone(BIOBUZZ_FORM) as unknown as Record<string, unknown>;
    extra.surprise = true;
    expect(parseForm(extra).ok).toBe(false);
    const nested = clone(BIOBUZZ_FORM);
    (nested.sections[0].fields[0] as unknown as Record<string, unknown>).evil = 1;
    expect(parseForm(nested).ok).toBe(false);
  });

  it("rejects bad keys/ids, over-long text, control characters and wrong types", () => {
    const f = (patch: Partial<FormField>) => parseForm(formWith([field({ key: "ok", type: "toggle", ...patch })])).ok;
    expect(f({})).toBe(true);
    expect(f({ key: "1bad" })).toBe(false);
    expect(f({ key: "has space" })).toBe(false);
    expect(f({ id: "has space" })).toBe(false);
    expect(f({ label: "x".repeat(FORM_LIMITS.label + 1) })).toBe(false);
    expect(f({ label: "bad\u0000label" })).toBe(false);
    expect(f({ label: "rtl‮trick" })).toBe(false);
    expect(f({ label: "   " })).toBe(false);
    expect(f({ min: Number.POSITIVE_INFINITY })).toBe(false);
    expect(f({ scoring: { mode: "teleport" as never } })).toBe(false);
    expect(f({ visibleWhen: { fieldKey: "x", op: "contains" as never, value: 1 } as never })).toBe(false);
  });

  it("enforces size limits", () => {
    const tooMany = formWith(Array.from({ length: FORM_LIMITS.fieldsPerSection + 1 }, (_, i) => field({ key: `k${i}`, type: "toggle" })));
    expect(parseForm(tooMany).ok).toBe(false);
    const sections = Array.from({ length: FORM_LIMITS.sections + 1 }, (_, i) => ({ id: `s${i}`, title: "S", phase: "misc", visible: true, fields: [] }));
    expect(parseForm({ ...clone(BIOBUZZ_FORM), sections }).ok).toBe(false);
    const options = Array.from({ length: FORM_LIMITS.options + 1 }, (_, i) => ({ value: `o${i}`, label: `O${i}` }));
    expect(parseForm(formWith([field({ key: "s", type: "select", options })])).ok).toBe(false);
  });

  it("reports readable paths for what is wrong", () => {
    const r = parseForm({ ...clone(BIOBUZZ_FORM), name: "" });
    expect(!r.ok && r.issues[0].path).toBe("name");
  });
});

describe("schema v2: new forms", () => {
  const blank = createBlankForm({ id: "blank", name: "  My form ", createdBy: "u1" });

  it("start with the five default phases and the locked system fields in Pre-Match", () => {
    expect(blank.sections.map((s) => s.phase)).toEqual([...STANDARD_PHASES]);
    expect(blank.sections.map((s) => s.title)).toEqual(["Pre-Match", "Autonomous", "Teleoperated", "Endgame", "Misc"]);
    expect(blank.sections[0].fields.map((f) => f.type)).toEqual(["matchPicker", "scoutName", "teamPicker"]);
    expect(blank.name).toBe("My form");
    expect(blank).toMatchObject({ status: "draft", version: 0, origin: "custom", formType: "match-scout" });
  });

  it("is valid except that scoring is on with nothing scoring; turning scoring off makes it clean", () => {
    expect(blockingIssues(checkForm(blank)).map((i) => i.code)).toEqual(["scoring-empty"]);
    expect(blockingIssues(checkForm({ ...blank, scoringEnabled: false }))).toEqual([]);
  });

  it("BIOBUZZ has no errors and no warnings", () => {
    expect(checkForm(BIOBUZZ_FORM)).toEqual([]);
  });
});

describe("checkForm: semantic rules", () => {
  it("flags duplicate keys and ids, empty labels, and empty category titles", () => {
    const dup = formWith([field({ key: "a", type: "toggle" }), field({ key: "a", type: "toggle", id: "other" })]);
    expect(codes(dup)).toContain("duplicate-key");
    const dupId = formWith([field({ key: "a", type: "toggle" }), field({ key: "b", type: "toggle", id: "f-a" })]);
    expect(codes(dupId)).toContain("duplicate-id");
    const blankLabel = formWith([field({ key: "a", type: "toggle", label: " " })]);
    expect(codes(blankLabel)).toContain("empty-label");
    const f = createBlankForm({ id: "z", name: "Z", createdBy: "u" });
    f.sections[1].title = " ";
    expect(codes(f)).toContain("empty-section-title");
  });

  it("requires each system field exactly once, in Pre-Match, always required", () => {
    const noTeam = createBlankForm({ id: "z", name: "Z", createdBy: "u" });
    noTeam.sections[0].fields = noTeam.sections[0].fields.filter((f) => f.type !== "teamPicker");
    expect(codes(noTeam)).toContain("missing-system-field");

    const twice = createBlankForm({ id: "z", name: "Z", createdBy: "u" });
    twice.sections[1].fields.push({ ...twice.sections[0].fields[0], id: "second-match" });
    expect(codes(twice)).toContain("duplicate-system-field");
    expect(codes(twice)).toContain("duplicate-key");

    const moved = createBlankForm({ id: "z", name: "Z", createdBy: "u" });
    moved.sections[1].fields.push(moved.sections[0].fields.shift()!); // the match picker now sits in Autonomous
    expect(codes(moved)).toContain("system-field-phase");

    const optional = createBlankForm({ id: "z", name: "Z", createdBy: "u" });
    optional.sections[0].fields[0].required = false;
    expect(codes(optional)).toContain("system-field-required");

    const conditional = createBlankForm({ id: "z", name: "Z", createdBy: "u" });
    conditional.sections[0].fields[1].visibleWhen = { fieldKey: "match", op: "checked" };
    expect(codes(conditional)).toContain("system-field-condition");
  });

  it("checks scoring: mode must fit the type, values and options must exist, caps can't be negative, and scoring-on needs something to score", () => {
    expect(codes(formWith([field({ key: "a", type: "text", scoring: { mode: "whenOn", value: 3 } })]))).toContain("scoring-mode");
    expect(codes(formWith([field({ key: "a", type: "toggle", scoring: { mode: "whenOn" } })]))).toContain("scoring-value");
    expect(codes(formWith([field({ key: "a", type: "select", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }], scoring: { mode: "byOption" } })]))).toContain("scoring-options");
    expect(codes(formWith([field({ key: "a", type: "counter", scoring: { mode: "perTally", value: 1, cap: -1 } })]))).toContain("scoring-cap");
    expect(codes(formWith([field({ key: "a", type: "toggle", scoring: { mode: "whenOn", value: 2 } })]))).not.toContain("scoring-empty");
    expect(codes(formWith([field({ key: "a", type: "toggle" })]))).toContain("scoring-empty");
    expect(codes(formWith([field({ key: "a", type: "toggle" })], { scoringEnabled: false }))).not.toContain("scoring-empty");
  });

  it("checks per-type settings: counters, options, ratings", () => {
    expect(codes(formWith([field({ key: "a", type: "counter", step: 0 })]))).toContain("counter-step");
    expect(codes(formWith([field({ key: "a", type: "counter", min: 5, max: 1 })]))).toContain("counter-range");
    expect(codes(formWith([field({ key: "a", type: "select", options: [{ value: "x", label: "X" }] })]))).toContain("options-count");
    expect(codes(formWith([field({ key: "a", type: "radio", options: [{ value: "x", label: "X" }, { value: "x", label: "Y" }] })]))).toContain("options-duplicate");
    expect(codes(formWith([field({ key: "a", type: "rating" })]))).toContain("rating-scale");
  });

  it("checks conditions: they must point at a real other field and be satisfiable, with no cycles", () => {
    const missing = formWith([field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "ghost", op: "checked" } })]);
    expect(codes(missing)).toContain("condition-missing");
    const self = formWith([field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "a", op: "checked" } })]);
    expect(codes(self)).toContain("condition-self");
    const cycle = formWith([
      field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "b", op: "checked" } }),
      field({ key: "b", type: "toggle", visibleWhen: { fieldKey: "a", op: "checked" } }),
    ]);
    expect(codes(cycle)).toContain("condition-cycle");
    const longCycle = formWith([
      field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "c", op: "checked" } }),
      field({ key: "b", type: "toggle", visibleWhen: { fieldKey: "a", op: "checked" } }),
      field({ key: "c", type: "toggle", visibleWhen: { fieldKey: "b", op: "checked" } }),
    ]);
    expect(codes(longCycle).filter((c) => c === "condition-cycle")).toHaveLength(3);

    const unreachableChecked = formWith([field({ key: "t", type: "text" }), field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "t", op: "checked" } })]);
    expect(codes(unreachableChecked)).toContain("condition-unreachable");
    const unreachableGt = formWith([field({ key: "t", type: "toggle" }), field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "t", op: "gt", value: 1 } })]);
    expect(codes(unreachableGt)).toContain("condition-unreachable");
    const select = field({ key: "s", type: "select", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] });
    expect(codes(formWith([select, field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "s", op: "equals", value: "z" } })]))).toContain("condition-unreachable");

    const fine = formWith([field({ key: "t", type: "toggle" }), field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "t", op: "checked" } })]);
    expect(codes(fine).filter((c) => c.startsWith("condition"))).toEqual([]);
  });

  it("checks key aliases and stat roles", () => {
    const f = formWith([field({ key: "newKey", type: "toggle" })], { keyAliases: { oldKey: "newKey" } });
    expect(codes(f)).not.toContain("alias-target");
    expect(codes({ ...f, keyAliases: { oldKey: "ghost" } })).toContain("alias-target");
    expect(codes({ ...f, keyAliases: { newKey: "newKey" } })).toContain("alias-self");
    expect(codes({ ...f, keyAliases: { comments: "newKey" } })).toContain("alias-shadow");
    expect(codes(formWith([field({ key: "a", type: "counter", statRoles: ["reliability"] })]))).toContain("stat-role-type");
    expect(codes(formWith([field({ key: "a", type: "toggle", statRoles: ["comments"] })]))).toContain("stat-role-comments");
  });

  it("warns (without blocking) about long categories, small touch targets and conditional required fields", () => {
    const many = formWith(Array.from({ length: 26 }, (_, i) => field({ key: `k${i}`, type: "toggle", scoring: { mode: "whenOn", value: 1 } })));
    const issues = checkForm(many);
    expect(issues.some((i) => i.code === "long-section" && i.severity === "warning")).toBe(true);
    expect(blockingIssues(issues)).toEqual([]);
    expect(codes(formWith([field({ key: "a", type: "counter", ui: { size: "sm" } })]))).toContain("small-target");
    const cond = formWith([field({ key: "t", type: "toggle" }), field({ key: "a", type: "text", required: true, visibleWhen: { fieldKey: "t", op: "checked" } })]);
    expect(checkForm(cond).find((i) => i.code === "required-conditional")?.severity).toBe("warning");
  });

  it("warns about controls that are hard to use one-handed, and about an unbounded per-unit number", () => {
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `o${i}`, label: `Option ${i}` }));
    expect(codes(formWith([field({ key: "r", type: "radio", options: opts(7) })]))).toContain("hard-one-handed");
    expect(codes(formWith([field({ key: "r", type: "radio", options: opts(6) })]))).not.toContain("hard-one-handed");
    expect(codes(formWith([field({ key: "s", type: "select", options: opts(13) })]))).toContain("hard-one-handed");
    expect(codes(formWith([field({ key: "g", type: "rating", scale: 8 })]))).toContain("hard-one-handed");
    expect(codes(formWith([field({ key: "g", type: "rating", scale: 5 })]))).not.toContain("hard-one-handed");
    const num = field({ key: "n", type: "number", scoring: { mode: "perUnit", value: 2 } });
    expect(codes(formWith([num]))).toContain("unbounded-number");
    expect(codes(formWith([{ ...num, max: 20 }]))).not.toContain("unbounded-number");
    const all = checkForm(formWith([field({ key: "r", type: "radio", options: opts(9) }), num]));
    expect(all.filter((i) => i.code === "hard-one-handed" || i.code === "unbounded-number").every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("visibility", () => {
  it("evaluates checked / equals / greater-than", () => {
    expect(conditionHolds({ fieldKey: "t", op: "checked" }, { t: true })).toBe(true);
    expect(conditionHolds({ fieldKey: "t", op: "checked" }, { t: false })).toBe(false);
    expect(conditionHolds({ fieldKey: "t", op: "checked" }, {})).toBe(false);
    expect(conditionHolds({ fieldKey: "s", op: "equals", value: "x" }, { s: "x" })).toBe(true);
    expect(conditionHolds({ fieldKey: "s", op: "equals", value: "x" }, { s: "y" })).toBe(false);
    expect(conditionHolds({ fieldKey: "n", op: "equals", value: 3 }, { n: 3 })).toBe(true);
    expect(conditionHolds({ fieldKey: "n", op: "gt", value: 2 }, { n: 3 })).toBe(true);
    expect(conditionHolds({ fieldKey: "n", op: "gt", value: 3 }, { n: 3 })).toBe(false);
    expect(conditionHolds({ fieldKey: "n", op: "gt", value: 1 }, { n: "5" })).toBe(true);
    expect(conditionHolds({ fieldKey: "n", op: "gt", value: 1 }, { n: "" })).toBe(false);
  });

  it("hides a field whose condition fails, and one whose parent is itself hidden, order-independently", () => {
    const f = formWith([
      field({ key: "child", type: "toggle", visibleWhen: { fieldKey: "mid", op: "checked" } }),
      field({ key: "mid", type: "toggle", visibleWhen: { fieldKey: "root", op: "checked" } }),
      field({ key: "root", type: "toggle" }),
    ]);
    const key = (values: Record<string, boolean>) => [...visibleFieldKeys(f, values)].filter((k) => ["child", "mid", "root"].includes(k)).sort();
    expect(key({})).toEqual(["root"]);
    expect(key({ root: true })).toEqual(["mid", "root"]);
    expect(key({ root: true, mid: true })).toEqual(["child", "mid", "root"]);
    expect(key({ root: false, mid: true })).toEqual(["root"]); // mid is hidden, so child can't show however mid is set
  });

  it("hides every field in a hidden category, and never loops on a cycle", () => {
    const f = formWith([field({ key: "a", type: "toggle" })]);
    f.sections.find((s) => s.id === "teleop")!.visible = false;
    expect(visibleFieldKeys(f, {}).has("a")).toBe(false);
    const cyc = formWith([field({ key: "a", type: "toggle", visibleWhen: { fieldKey: "b", op: "checked" } }), field({ key: "b", type: "toggle", visibleWhen: { fieldKey: "a", op: "checked" } })]);
    expect(visibleFieldKeys(cyc, { a: true, b: true }).has("a")).toBe(false);
  });
});

describe("scoring: every mode", () => {
  const toggle = field({ key: "t", type: "toggle", scoring: { mode: "whenOn", value: 7 } });
  const counter = field({ key: "c", type: "counter", scoring: { mode: "perTally", value: 3 } });
  const number = field({ key: "n", type: "number", scoring: { mode: "perUnit", value: 2 } });
  const rating = field({ key: "r", type: "rating", scale: 5, scoring: { mode: "perUnit", value: 4 } });
  const select = field({
    key: "s",
    type: "select",
    options: [
      { value: "none", label: "None", points: 0 },
      { value: "low", label: "Low", points: 5 },
      { value: "high", label: "High", points: 12 },
    ],
    scoring: { mode: "byOption" },
  });

  it("whenOn: the value when a toggle/checkbox is on", () => {
    expect(fieldPoints(toggle, true)).toBe(7);
    expect(fieldPoints(toggle, false)).toBe(0);
    expect(fieldPoints({ ...toggle, type: "checkbox" }, true)).toBe(7);
    expect(fieldPoints(toggle, "true")).toBe(0); // only a real boolean scores
  });
  it("perTally: value per tally; negative or junk tallies score zero", () => {
    expect(fieldPoints(counter, 4)).toBe(12);
    expect(fieldPoints(counter, 0)).toBe(0);
    expect(fieldPoints(counter, -3)).toBe(0);
    expect(fieldPoints(counter, "x")).toBe(0);
  });
  it("perUnit: value per unit of a number or rating", () => {
    expect(fieldPoints(number, 2.5)).toBe(5);
    expect(fieldPoints(number, "")).toBe(0);
    expect(fieldPoints(number, "3")).toBe(6);
    expect(fieldPoints(rating, 3)).toBe(12);
  });
  it("byOption: the chosen option's own points", () => {
    expect(fieldPoints(select, "high")).toBe(12);
    expect(fieldPoints(select, "low")).toBe(5);
    expect(fieldPoints(select, "ghost")).toBe(0);
    expect(fieldPoints(select, "")).toBe(0);
  });
  it("none, a missing rule, and a mode that doesn't fit the type all give zero", () => {
    expect(fieldPoints(field({ key: "x", type: "toggle", scoring: { mode: "none" } }), true)).toBe(0);
    expect(fieldPoints(field({ key: "x", type: "toggle" }), true)).toBe(0);
    expect(fieldPoints(field({ key: "x", type: "text", scoring: { mode: "whenOn", value: 9 } }), true)).toBe(0);
    expect(fieldPoints(field({ key: "x", type: "toggle", scoring: { mode: "perTally", value: 9 } }), 3)).toBe(0);
  });
  it("cap bounds a field's points", () => {
    expect(fieldPoints({ ...counter, scoring: { mode: "perTally", value: 3, cap: 10 } }, 9)).toBe(10);
    expect(fieldPoints({ ...counter, scoring: { mode: "perTally", value: 3, cap: 10 } }, 2)).toBe(6);
    expect(fieldPoints({ ...select, scoring: { mode: "byOption", cap: 8 } }, "high")).toBe(8);
  });

  it("rolls each field into its section's phase and totals them", () => {
    const f = formWith([toggle, counter]);
    f.sections.find((s) => s.id === "autonomous")!.fields.push(number);
    f.sections.find((s) => s.id === "endgame")!.fields.push(select);
    const score = calculateScore(f, { t: true, c: 2, n: 1.5, s: "high" });
    expect(score.byPhase).toEqual({ teleop: 13, auto: 3, endgame: 12 });
    expect(score).toMatchObject({ auto: 3, teleop: 13, endgame: 12, total: 28 });
  });
  it("custom phases roll into the total and byPhase, not into the three standard subtotals", () => {
    const f = formWith([toggle]);
    f.sections.push({ id: "bonus", title: "Bonus", phase: "bonus", visible: true, fields: [field({ key: "b", type: "toggle", scoring: { mode: "whenOn", value: 10 } })] });
    const score = calculateScore(f, { t: true, b: true });
    expect(score).toMatchObject({ teleop: 7, total: 17, byPhase: { teleop: 7, bonus: 10 } });
    expect(storableScore(score)).toEqual({ auto: 0, teleop: 7, endgame: 0, total: 17, byPhase: { teleop: 7, bonus: 10 } });
    expect(storableScore(calculateScore(formWith([toggle]), { t: true }))).toEqual({ auto: 0, teleop: 7, endgame: 0, total: 7 }); // no byPhase when nothing else scored
  });
  it("ignores hidden fields (a failed condition or a hidden category) and scores zero when scoring is off", () => {
    const cond = field({ key: "bonus", type: "toggle", scoring: { mode: "whenOn", value: 5 }, visibleWhen: { fieldKey: "t", op: "checked" } });
    const f = formWith([toggle, cond]);
    expect(calculateScore(f, { t: false, bonus: true }).total).toBe(0);
    expect(calculateScore(f, { t: true, bonus: true }).total).toBe(12);
    const hidden = formWith([toggle]);
    hidden.sections.find((s) => s.id === "teleop")!.visible = false;
    expect(calculateScore(hidden, { t: true }).total).toBe(0);
    expect(calculateScore({ ...formWith([toggle]), scoringEnabled: false }, { t: true })).toEqual({ auto: 0, teleop: 0, endgame: 0, total: 0, byPhase: {} });
  });
  it("only counts a form with no scoring rules as zero", () => {
    expect(calculateScore(createBlankForm({ id: "x", name: "X", createdBy: "u" }), { comments: "hi" }).total).toBe(0);
  });

  it("maxScore: sums what can be reached; unbounded counters make it unknown", () => {
    const f = formWith([toggle, { ...counter, max: 5 }, select]);
    expect(maxScore(f)).toEqual({ total: 7 + 15 + 12, byPhase: { teleop: 34 } });
    expect(maxScore(formWith([toggle, counter])).total).toBeNull();
    expect(maxScore(formWith([toggle, { ...counter, scoring: { mode: "perTally", value: 3, cap: 20 } }])).total).toBe(27);
    expect(maxScore(formWith([rating])).total).toBe(20);
    expect(maxScore({ ...formWith([toggle]), scoringEnabled: false }).total).toBe(0);
  });
});

describe("values", () => {
  const f = formWith([
    field({ key: "t", type: "toggle" }),
    field({ key: "c", type: "counter", min: 1, max: 4 }),
    field({ key: "n", type: "number", min: 0, max: 10, decimals: 1 }),
    field({ key: "s", type: "select", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b" }),
    field({ key: "r", type: "rating", scale: 5 }),
    field({ key: "x", type: "text" }),
  ]);

  it("defaults: toggles off, counters at their minimum, numbers blank, a declared default wins; system fields are not values", () => {
    expect(defaultValues(f)).toMatchObject({ t: false, c: 1, n: "", s: "b", r: 0, x: "", comments: "" });
    expect(Object.keys(defaultValues(f))).not.toContain("match");
    expect(Object.keys(defaultValues(f))).not.toContain("teamNumber");
  });

  it("coerces and clamps: wrong types fall back, ranges are enforced, decimals round, unknown options fall back", () => {
    const get = (key: string) => f.sections[2].fields.find((x) => x.key === key)!;
    expect(coerceFieldValue(get("t"), "true")).toBe(true);
    expect(coerceFieldValue(get("t"), 1)).toBe(false);
    expect(coerceFieldValue(get("c"), 99)).toBe(4);
    expect(coerceFieldValue(get("c"), -5)).toBe(1);
    expect(coerceFieldValue(get("c"), 2.6)).toBe(3);
    expect(coerceFieldValue(get("c"), "abc")).toBe(1);
    expect(coerceFieldValue(get("n"), "3.14159")).toBe(3.1);
    expect(coerceFieldValue(get("n"), 50)).toBe(10);
    expect(coerceFieldValue(get("n"), "")).toBe("");
    expect(coerceFieldValue(get("s"), "zzz")).toBe("b");
    expect(coerceFieldValue(get("r"), 9)).toBe(5);
    expect(coerceFieldValue(get("x"), 123)).toBe("");
  });

  it("normalizeValues applies aliases, fills defaults and drops unknown keys", () => {
    const withAlias = { ...f, keyAliases: { oldToggle: "t", ancientToggle: "oldToggle" } };
    const out = normalizeValues(withAlias, { oldToggle: true, c: 3, mystery: "?" });
    expect(out.t).toBe(true);
    expect(out.c).toBe(3);
    expect("mystery" in out).toBe(false);
    expect(out.s).toBe("b");
    expect(normalizeValues(withAlias, { ancientToggle: true }).t).toBe(true); // a twice-renamed key
  });

  it("aliases: transitive, cycle-safe, and a current key beats an aliased old one", () => {
    expect(resolveAlias("a", { a: "b", b: "c" })).toBe("c");
    expect(resolveAlias("a", { a: "b", b: "a" })).toBeTypeOf("string"); // terminates
    expect(applyAliases({ old: 1, current: 2 }, { old: "current" })).toEqual({ current: 2 });
    expect(applyAliases({ old: 1 }, { old: "current" })).toEqual({ current: 1 });
    expect(applyAliases({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it("validateValues: required fields, but only while visible; a required toggle must be on", () => {
    const req = formWith([
      field({ key: "gate", type: "toggle" }),
      field({ key: "why", type: "text", required: true, visibleWhen: { fieldKey: "gate", op: "checked" } }),
      field({ key: "ack", type: "checkbox", required: true }),
      field({ key: "pick", type: "select", required: true, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
      field({ key: "num", type: "number", required: true }),
      field({ key: "stars", type: "rating", scale: 5, required: true }),
    ]);
    const base = { gate: false, why: "", ack: true, pick: "a", num: 0, stars: 3 };
    expect(validateValues(req, base)).toEqual({});
    expect(Object.keys(validateValues(req, { ...base, gate: true }))).toEqual(["why"]);
    expect(Object.keys(validateValues(req, { ...base, ack: false, pick: "", num: "", stars: 0 })).sort()).toEqual(["ack", "num", "pick", "stars"]);
    expect(validateValues(req, { ...base, gate: true, why: "because" })).toEqual({});
  });

  it("commentsFrom reads the field tagged with the comments role", () => {
    expect(commentsFrom(f, { comments: "robot tipped" })).toBe("robot tipped");
    expect(commentsFrom(f, {})).toBe("");
    expect(commentsFrom(formWith([]), { comments: "x" })).toBe("x");
  });
});
