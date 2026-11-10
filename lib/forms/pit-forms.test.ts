import { describe, expect, it } from "vitest";
import { buildSubmission, validateSubmission } from "@/lib/forms/form-page-logic";
import { getBuiltinForm, BUILTIN_FORMS } from "@/lib/forms/builtin";
import { HELPER_FORM, PIT_AUTO_STEPS, PIT_SCOUT_FORM, TEAM_STRATEGY_FORM } from "@/lib/forms/builtin-pit-forms";
import { isRookieIn, rookieSuggestion, weightInPounds } from "@/lib/forms/pit-suggest";
import { addStep, canAddStep, moveStep, normalizeSequence, parseSequenceSummary, summarizeSequence } from "@/lib/forms/sequence";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";
import { diffEntryValues } from "@/lib/form-entries-model";
import { officialTemplates } from "@/lib/templates/official";
import type { Form, FormField } from "@/lib/forms/types";

// P29: the Pit Scout, Team Strategy and Helper forms, the auto cycle rules, and the rookie suggestion.

const fieldsOf = (f: Form): FormField[] => f.sections.flatMap((s) => s.fields);
const keys = (f: Form) => fieldsOf(f).map((x) => x.key);
const answers = (teamNumber: number | null = 111) => ({ eventCode: "EVT1", matchKey: null, alliance: null, teamNumber, scoutName: "Ada" });

describe("the three built-in forms", () => {
  it("are registered, valid and parse", () => {
    for (const id of ["pit-scout-v1", "team-strategy-v1", "helper-v1"]) {
      const form = getBuiltinForm(id)!;
      expect(form, id).toBeTruthy();
      expect(BUILTIN_FORMS[id]).toBe(form);
      expect(blockingIssues(checkForm(form)).map((i) => i.message), id).toEqual([]);
      expect(parseForm(JSON.parse(JSON.stringify(form))).ok, id).toBe(true);
      expect(form.scoringEnabled, id).toBe(false); // no scoring
      expect(form.stickyNotes?.enabled, id).toBe(true);
    }
  });

  it("are seeded as official templates too", () => {
    const ids = officialTemplates().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["official-pit-scout", "official-team-strategy", "official-helper"]));
  });

  it("the Pit Scout form has the fields the brief lists, in order", () => {
    expect(keys(PIT_SCOUT_FORM)).toEqual(["eventCode", "teamNumber", "scoutName", "weight", "weightUnit", "rookie", "photos", "friendlyPit", "friendlyDrive", "capabilities", "capacity", "preloaded", "cycleTime", "autoCycle"]);
    const photo = fieldsOf(PIT_SCOUT_FORM).find((f) => f.key === "photos")!;
    expect(photo).toMatchObject({ type: "image", maxCount: 3, capture: true });
    // the auto cycle is the last field on the form
    expect(keys(PIT_SCOUT_FORM).at(-1)).toBe("autoCycle");
  });

  it("the Team Strategy form: best at has the five roles, then four ability checkboxes", () => {
    expect(keys(TEAM_STRATEGY_FORM)).toEqual(["eventCode", "teamNumber", "scoutName", "bestAt", "canScoreHive", "canScoreFlower", "shootWhileIntaking", "shootWhileMoving"]);
    const best = fieldsOf(TEAM_STRATEGY_FORM).find((f) => f.key === "bestAt")!;
    expect(best.options?.map((o) => o.label)).toEqual(["Hive", "Flower", "Garden", "Gathering", "Defense"]);
  });

  it("the Helper form: team helped, a required yes/no and a required issue", () => {
    expect(keys(HELPER_FORM)).toEqual(["eventCode", "teamNumber", "scoutName", "successful", "issues"]);
    const team = fieldsOf(HELPER_FORM).find((f) => f.key === "teamNumber")!;
    expect(team.label).toBe("Team helped");
    expect(validateSubmission(HELPER_FORM, answers(null), defaultValues(HELPER_FORM), undefined)).toMatchObject({ teamNumber: expect.any(String), successful: expect.any(String), issues: expect.any(String) });
    const ok = { ...defaultValues(HELPER_FORM), successful: "yes", issues: "Loose belt" };
    expect(validateSubmission(HELPER_FORM, answers(111), ok, undefined)).toEqual({});
  });
});

describe("Pit Scout capabilities grid", () => {
  const matrix = fieldsOf(PIT_SCOUT_FORM).find((f) => f.key === "capabilities")!;

  it("has Leave, Park and the three scoring rows by Autonomous and Teleop/Endgame, with Leave in Teleop switched off", () => {
    expect(matrix.rows?.map((r) => r.key)).toEqual(["leave", "park", "hive", "garden", "flower"]);
    expect(matrix.cols?.map((c) => c.key)).toEqual(["auto", "teleop"]);
    expect(matrix.disabledCells).toEqual(["leave_teleop"]);
  });

  it("a disabled cell can't be stored, even if one sneaks in", () => {
    const stored = normalizeValues(PIT_SCOUT_FORM, { capabilities: { leave_auto: true, leave_teleop: true, hive_teleop: true } });
    expect(stored.capabilities).toMatchObject({ leave_auto: true, hive_teleop: true, hive_auto: false });
    expect(Object.keys(stored.capabilities as object)).not.toContain("leave_teleop");
  });
});

describe("Pit Scout auto cycle", () => {
  const ids = (xs: string[]) => normalizeSequence(PIT_AUTO_STEPS, xs);

  it("Leave and Park are once-only and pinned first and last", () => {
    expect(PIT_AUTO_STEPS.find((s) => s.id === "leave")).toMatchObject({ maxCount: 1, pin: "first" });
    expect(PIT_AUTO_STEPS.find((s) => s.id === "park")).toMatchObject({ maxCount: 1, pin: "last" });
    let seq: string[] = [];
    seq = addStep(PIT_AUTO_STEPS, seq, "hive");
    seq = addStep(PIT_AUTO_STEPS, seq, "park");
    seq = addStep(PIT_AUTO_STEPS, seq, "leave");
    seq = addStep(PIT_AUTO_STEPS, seq, "garden");
    expect(seq).toEqual(["leave", "hive", "garden", "park"]);
    expect(canAddStep(PIT_AUTO_STEPS, seq, "leave")).toBe(false);
    expect(canAddStep(PIT_AUTO_STEPS, seq, "park")).toBe(false);
    expect(canAddStep(PIT_AUTO_STEPS, seq, "hive")).toBe(true); // scoring repeats
  });

  it("the middle steps move but can't pass the pinned ends", () => {
    const seq = ["leave", "hive", "garden", "park"];
    expect(moveStep(PIT_AUTO_STEPS, seq, 2, 1)).toEqual(["leave", "garden", "hive", "park"]);
    expect(moveStep(PIT_AUTO_STEPS, seq, 1, 0)).toEqual(seq);
    expect(moveStep(PIT_AUTO_STEPS, seq, 2, 3)).toEqual(seq);
  });

  it("a stored sequence is cleaned back into the rules", () => {
    expect(ids(["hive", "leave", "leave", "park", "garden"])).toEqual(["leave", "hive", "garden", "park"]);
  });

  it("the text summary is the short flow and round-trips", () => {
    const seq = ["leave", "hive", "garden", "hive", "park"];
    expect(summarizeSequence(PIT_AUTO_STEPS, seq, " > ")).toBe("Leave > Hive > Garden > Hive > Park");
    expect(parseSequenceSummary(PIT_AUTO_STEPS, "Leave → Hive → Garden → Hive → Park")).toEqual(seq);
    expect(parseSequenceSummary(PIT_AUTO_STEPS, "Leave → Score Into Hive → Park")).toEqual(["leave", "hive", "park"]);
  });
});

describe("Pit Scout weight unit", () => {
  it("defaults to lb and is stored with the number", () => {
    expect(defaultValues(PIT_SCOUT_FORM).weightUnit).toBe("lb");
    const values = { ...defaultValues(PIT_SCOUT_FORM), weight: 11.5, weightUnit: "kg" };
    const sub = buildSubmission(PIT_SCOUT_FORM, answers(222), values, [], 0, null);
    expect(sub.values).toMatchObject({ weight: 11.5, weightUnit: "kg" });
    expect(sub.formType).toBe("pit-scout");
    expect(sub.teamNumber).toBe(222);
  });

  it("converts kg to pounds for comparison", () => {
    expect(weightInPounds(10, "kg")).toBe(22);
    expect(weightInPounds(24.5, "lb")).toBe(24.5);
    expect(weightInPounds("", "lb")).toBeNull();
    expect(weightInPounds(undefined, "kg")).toBeNull();
  });
});

describe("rookie suggestion", () => {
  it("is a rookie in the season of its rookie year, not otherwise, unknown without data", () => {
    expect(isRookieIn({ rookieYear: 2025 }, 2025)).toBe(true);
    expect(isRookieIn({ rookieYear: 2019 }, 2025)).toBe(false);
    expect(isRookieIn({ rookieYear: null }, 2025)).toBeNull();
    expect(isRookieIn(undefined, 2025)).toBeNull();
  });

  it("gives a value and a hint to show, and nothing when unknown", () => {
    const r = rookieSuggestion({ rookieYear: 2025 }, 2025)!;
    expect(r.values).toEqual({ rookie: true });
    expect(r.hints.rookie).toContain("rookie year 2025");
    expect(rookieSuggestion({ rookieYear: 2015 }, 2025)!.values).toEqual({ rookie: false });
    expect(rookieSuggestion({ rookieYear: null }, 2025)).toBeNull();
  });
});

describe("editing an earlier entry", () => {
  it("lists only the keys that changed, sorted", () => {
    expect(diffEntryValues({ a: 1, b: "x", c: ["p"] }, { a: 1, b: "y", c: ["p"], d: true })).toEqual(["b", "d"]);
    expect(diffEntryValues({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffEntryValues({ a: 1 }, {})).toEqual(["a"]);
  });
});
