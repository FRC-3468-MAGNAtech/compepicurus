import { describe, expect, it } from "vitest";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { DRIVE_REFLECTION_FORM, LEAD_SCOUT_FORM, MATCH_STRATEGY_FORM } from "@/lib/forms/builtin-team-forms";
import { allianceTeamsFor, allianceTitle, buildSubmission, resetSlotValues, trimSlots, validateSubmission } from "@/lib/forms/form-page-logic";
import { checkForm, blockingIssues, parseForm } from "@/lib/forms/validate";
import { defaultValues } from "@/lib/forms/values";
import { findPlanEntry, expandFieldMap, diffAgainstPlan } from "@/lib/forms/compare";
import { exportForm, importForm } from "@/lib/forms/portable";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { officialTemplates } from "@/lib/templates/official";

// P28: the three built-in forms and the pure logic of their pages.

const match = (matchType: OfficialMatch["matchType"], matchNumber: number, red: number[], blue: number[]): OfficialMatch => ({ eventCode: "EVT", matchType, matchNumber, played: false, red: { teams: red, score: null, penaltyPoints: null }, blue: { teams: blue, score: null, penaltyPoints: null } });
const MATCHES = [match("Qualification", 5, [1111, 2222], [3333, 4444]), match("Playoff", 2, [10, 20, 30], [40, 50, 60])];

describe("the built-in match-based forms", () => {
  const forms = [LEAD_SCOUT_FORM, MATCH_STRATEGY_FORM, DRIVE_REFLECTION_FORM];

  it("are valid, don't score, and are registered as built-ins with their types", () => {
    for (const f of forms) {
      expect(parseForm(f).ok, f.id).toBe(true);
      expect(blockingIssues(checkForm(f)), f.id).toEqual([]);
      expect(f.scoringEnabled).toBe(false);
      expect(BUILTIN_FORMS[f.id]).toBe(f);
    }
    expect(forms.map((f) => [f.id, f.formType])).toEqual([
      ["lead-scout-v1", "lead-scout"],
      ["match-strategy-v1", "match-strategy"],
      ["drive-reflection-v1", "drive-reflection"],
    ]);
  });

  it("Lead Scout: event, match, alliance, scout; an alliance box and a per-team group of team, notes and 1-5 skill; no sticky notes by default", () => {
    const pre = LEAD_SCOUT_FORM.sections[0].fields.map((f) => f.type);
    expect(pre).toEqual(["eventPicker", "matchPicker", "alliancePicker", "scoutName"]);
    const alliance = LEAD_SCOUT_FORM.sections.find((s) => s.id === "alliance")!.fields;
    expect(alliance.map((f) => [f.key, f.type])).toEqual([["allianceNotes", "textarea"], ["allianceSkill", "slider"]]);
    expect([alliance[1].min, alliance[1].max]).toEqual([1, 5]);
    const teams = LEAD_SCOUT_FORM.sections.find((s) => s.id === "teams")!;
    expect(teams.groups?.[0].repeat).toEqual({ source: "allianceTeams", maxSlots: 3 });
    expect(teams.fields.map((f) => [f.key, f.type])).toEqual([["team", "teamPicker"], ["notes", "textarea"], ["skill", "slider"]]);
    expect(LEAD_SCOUT_FORM.stickyNotes).toBeUndefined();
  });

  it("Match Strategy: event, alliance, match, scout; per team a role (Hive, Flower, Garden, Gathering, Defense) and 'Will score in auto'; sticky notes on", () => {
    expect(MATCH_STRATEGY_FORM.sections[0].fields.map((f) => f.type)).toEqual(["eventPicker", "alliancePicker", "matchPicker", "scoutName"]);
    const fields = MATCH_STRATEGY_FORM.sections[1].fields;
    expect(fields.map((f) => [f.key, f.type])).toEqual([["team", "teamPicker"], ["role", "select"], ["auto", "checkbox"]]);
    expect(fields[1].options?.map((o) => o.label)).toEqual(["Hive", "Flower", "Garden", "Gathering", "Defense"]);
    expect(fields[2].label).toBe("Will score in auto");
    expect(MATCH_STRATEGY_FORM.stickyNotes?.enabled).toBe(true);
  });

  it("Drive Reflection: the same fields (scored, not will score) and a comparison with the Match Strategy for the same event, match and alliance", () => {
    expect(DRIVE_REFLECTION_FORM.sections[1].fields.map((f) => f.key)).toEqual(MATCH_STRATEGY_FORM.sections[1].fields.map((f) => f.key));
    expect(DRIVE_REFLECTION_FORM.sections[1].fields[2].label).toBe("Scored in auto");
    expect(DRIVE_REFLECTION_FORM.compareWith).toEqual({ formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: { role: "role", auto: "auto" } });
    expect(DRIVE_REFLECTION_FORM.stickyNotes?.enabled).toBe(true);
  });

  it("the Drive Reflection finds and compares against the Match Strategy entry", () => {
    const plan = { id: "plan", formId: "match-strategy-v1", eventCode: "EVT", matchKey: "Q5", alliance: "red", createdAtMs: 1, values: { t1_role: "hive", t1_auto: true, t2_role: "flower", t2_auto: false } };
    const found = findPlanEntry([plan], DRIVE_REFLECTION_FORM.compareWith!, { eventCode: "EVT", matchKey: "Q5", alliance: "red" });
    expect(found?.id).toBe("plan");
    const pairs = expandFieldMap(DRIVE_REFLECTION_FORM, DRIVE_REFLECTION_FORM.compareWith!.fieldMap, 2);
    const actual = { ...defaultValues(DRIVE_REFLECTION_FORM), t1_role: "hive", t1_auto: false, t2_role: "garden", t2_auto: false };
    expect(diffAgainstPlan(pairs, actual, plan.values).map((d) => d.key).sort()).toEqual(["t1_auto", "t2_role"]);
  });

  it("export and import round-trip them, and they are public official templates", () => {
    for (const f of forms) {
      const back = importForm(JSON.parse(JSON.stringify(exportForm(f))));
      expect(back.ok, f.id).toBe(true);
    }
    expect(officialTemplates().map((t) => t.id)).toEqual(["official-biobuzz", "official-blank", "official-lead-scout", "official-match-strategy", "official-drive-reflection", "official-pit-scout", "official-team-strategy", "official-helper"]);
  });
});

describe("page logic", () => {
  it("finds an alliance's teams in the schedule: 2 in a qualification, 3 in the playoffs", () => {
    expect(allianceTeamsFor(MATCHES, "EVT", "Q5", "red")).toEqual([1111, 2222]);
    expect(allianceTeamsFor(MATCHES, "EVT", "Q5", "blue")).toEqual([3333, 4444]);
    expect(allianceTeamsFor(MATCHES, "EVT", "F2", "red")).toEqual([10, 20, 30]);
    expect(allianceTeamsFor(MATCHES, "EVT", "Q9", "red")).toEqual([]);
    expect(allianceTeamsFor(MATCHES, "EVT", null, "red")).toEqual([]);
    expect(allianceTeamsFor(MATCHES, "EVT", "Q5", null)).toEqual([]);
    expect(allianceTeamsFor(MATCHES, "OTHER", "Q5", "red")).toEqual([]);
  });

  it("titles the alliance box like RED / 1111, 2222", () => {
    expect(allianceTitle("red", [1111, 2222])).toBe("RED / 1111, 2222");
    expect(allianceTitle("blue", [1, 2, 3])).toBe("BLUE / 1, 2, 3");
    expect(allianceTitle("red", [])).toBe("RED");
    expect(allianceTitle(null, [1])).toBe("Alliance");
  });

  it("changing the match resets only the per-team answers", () => {
    const v = { ...defaultValues(LEAD_SCOUT_FORM), allianceNotes: "keep me", t1_notes: "drop me", t2_skill: 5, t1_team: 1111 };
    const next = resetSlotValues(LEAD_SCOUT_FORM, v);
    expect(next.allianceNotes).toBe("keep me");
    expect(next.t1_notes).toBe("");
    expect(next.t2_skill).toBe(1);
    expect(next.t1_team).toBe("");
  });

  it("trims the slots beyond the alliance's size before saving", () => {
    const v = { ...defaultValues(LEAD_SCOUT_FORM), t1_notes: "a", t2_notes: "b", t3_notes: "c" };
    expect(Object.keys(trimSlots(v, 2)).filter((k) => k.startsWith("t3_"))).toEqual([]);
    expect(trimSlots(v, 3).t3_notes).toBe("c");
    expect(trimSlots(v, 2).allianceNotes).toBe("");
  });

  it("asks for the pickers the form has, and nothing the form doesn't", () => {
    const empty = { eventCode: "", matchKey: null, alliance: null, teamNumber: null, scoutName: "Ada" };
    expect(Object.keys(validateSubmission(LEAD_SCOUT_FORM, empty, defaultValues(LEAD_SCOUT_FORM), 2)).sort()).toEqual(["alliance", "eventCode", "match"]);
    const ok = { eventCode: "EVT", matchKey: "Q5", alliance: "red" as const, teamNumber: null, scoutName: "Ada" };
    expect(validateSubmission(LEAD_SCOUT_FORM, ok, defaultValues(LEAD_SCOUT_FORM), 2)).toEqual({});
  });

  it("builds the saved entry: pickers, trimmed slots, notes without blanks, and the plan link only on a form that compares", () => {
    const answers = { eventCode: "EVT", matchKey: "Q5", alliance: "red" as const, teamNumber: null, scoutName: "Ada" };
    const values = { ...defaultValues(DRIVE_REFLECTION_FORM), t1_role: "hive", t2_role: "flower", t3_role: "garden" };
    const notes = [{ id: "1", text: "  late  ", color: "yellow", createdAt: 1 }, { id: "2", text: " ", color: "yellow", createdAt: 2 }];
    const doc = buildSubmission(DRIVE_REFLECTION_FORM, answers, values, notes, 2, { differences: 1, linkedEntryId: "plan" });
    expect(doc).toMatchObject({ formId: "drive-reflection-v1", formType: "drive-reflection", eventCode: "EVT", matchKey: "Q5", alliance: "red", linkedEntryId: "plan", planDifferences: 1 });
    expect(doc).not.toHaveProperty("teamNumber");
    expect(doc.values).toMatchObject({ t1_role: "hive", t2_role: "flower" });
    expect(Object.keys(doc.values).some((k) => k.startsWith("t3_"))).toBe(false);
    expect(doc.stickyNotes).toEqual([{ id: "1", text: "late", color: "yellow", createdAt: 1 }]);
    const lead = buildSubmission(LEAD_SCOUT_FORM, answers, defaultValues(LEAD_SCOUT_FORM), [], 3, { differences: 4, linkedEntryId: "x" });
    expect(lead).not.toHaveProperty("linkedEntryId");
    expect(lead.stickyNotes).toEqual([]);
    expect(Object.keys(lead.values).filter((k) => k.startsWith("t3_")).length).toBeGreaterThan(0); // a 3-team alliance keeps all three
  });
});
