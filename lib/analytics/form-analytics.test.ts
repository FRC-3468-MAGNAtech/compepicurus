import { describe, expect, it } from "vitest";
import { FORM_ANALYTICS_PAGES, buildFormSchema, entriesOfUnit, eventCodesForScope, formAnalyticsPage, formAnalyticsPageForPath, isFormAnalyticsRoute, latestPerUnit, selectFormEntries } from "@/lib/analytics/form-analytics";
import { helperAnalytics, leadScoutSummary, pitSummary, planRows, reflectionRows, slotTeams, teamPitStrategy, teamStrategySummary, wentToPlan } from "@/lib/analytics/form-summaries";
import { formEntryToRow, type FormEntry } from "@/lib/form-entries-model";
import { entriesToCsv } from "@/lib/analytics/csv";
import { DRIVE_REFLECTION_FORM, LEAD_SCOUT_FORM, MATCH_STRATEGY_FORM } from "@/lib/forms/builtin-team-forms";
import { HELPER_FORM, PIT_SCOUT_FORM, TEAM_STRATEGY_FORM } from "@/lib/forms/builtin-pit-forms";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";

let n = 0;
const entry = (over: Partial<FormEntry>): FormEntry => ({
  id: `e${++n}`,
  teamId: "t",
  uid: "u1",
  scoutName: "Ada",
  formId: "pit-scout-v1",
  formVersion: 1,
  formType: "pit-scout",
  eventCode: "EVT1",
  teamNumber: 111,
  values: {},
  stickyNotes: [],
  flags: [],
  excluded: false,
  createdAtMs: n,
  updatedAtMs: n,
  ...over,
});
const PIT = FORM_ANALYTICS_PAGES.find((p) => p.slug === "pit-scout")!;
const LEAD = FORM_ANALYTICS_PAGES.find((p) => p.slug === "lead-scout")!;
const REFL = FORM_ANALYTICS_PAGES.find((p) => p.slug === "drive-reflection")!;
const PLAN = FORM_ANALYTICS_PAGES.find((p) => p.slug === "match-strategy")!;

describe("the six pages", () => {
  it("are registered in the order the brief gives, each with a built-in form that exists", () => {
    expect(FORM_ANALYTICS_PAGES.map((p) => p.slug)).toEqual(["lead-scout", "pit-scout", "team-strategy", "match-strategy", "drive-reflection", "helper"]);
    for (const p of FORM_ANALYTICS_PAGES) {
      expect(BUILTIN_FORMS[p.formId]?.formType, p.slug).toBe(p.formType);
      expect(p.href).toBe(`/analytics/${p.slug}`);
    }
  });

  it("are found from a path, and the filter bar treats exactly them as form routes", () => {
    expect(formAnalyticsPageForPath("/analytics/pit-scout")?.slug).toBe("pit-scout");
    expect(formAnalyticsPageForPath("/analytics/pit-scout/")?.slug).toBe("pit-scout");
    expect(formAnalyticsPage("helper")?.title).toBe("Helper Analytics");
    expect(isFormAnalyticsRoute("/analytics/match-scout")).toBe(false);
    expect(isFormAnalyticsRoute("/analytics/team-averages")).toBe(false);
    expect(isFormAnalyticsRoute("/analytics/lead-scout")).toBe(true);
  });
});

describe("selecting entries", () => {
  const all = [entry({ eventCode: "A" }), entry({ eventCode: "B" }), entry({ eventCode: "A", excluded: true }), entry({ formType: "helper", eventCode: "A" })];

  it("filters by form type and by the event filter; excluded only when asked", () => {
    expect(selectFormEntries(all, "pit-scout", ["A"])).toHaveLength(1);
    expect(selectFormEntries(all, "pit-scout", ["A"], { includeExcluded: true })).toHaveLength(2);
    expect(selectFormEntries(all, "pit-scout", null)).toHaveLength(2);
    expect(selectFormEntries(all, "pit-scout", [])).toHaveLength(0);
  });

  it("turns the event scope into codes", () => {
    expect(eventCodesForScope({ kind: "all" }, ["A"])).toBeNull();
    expect(eventCodesForScope({ kind: "active" }, ["A", "B"])).toEqual(["A", "B"]);
    expect(eventCodesForScope({ kind: "custom", codes: ["C"] }, ["A"])).toEqual(["C"]);
  });
});

describe("latest entry per unit", () => {
  it("keeps the newest entry per team per event, and lists all of a unit's entries on request", () => {
    const a = entry({ teamNumber: 1, createdAtMs: 10 });
    const b = entry({ teamNumber: 1, createdAtMs: 20 });
    const c = entry({ teamNumber: 2, createdAtMs: 5 });
    const d = entry({ teamNumber: 1, eventCode: "EVT2", createdAtMs: 1 });
    expect(latestPerUnit(PIT, [a, b, c, d]).map((e) => e.id)).toEqual([b.id, c.id, d.id]);
    expect(entriesOfUnit(PIT, [a, b, c, d], b).map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("a match unit is event + match + alliance", () => {
    const x = entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", createdAtMs: 1 });
    const y = entry({ formType: "lead-scout", matchKey: "Q1", alliance: "blue", createdAtMs: 2 });
    const z = entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", createdAtMs: 3 });
    expect(latestPerUnit(LEAD, [x, y, z]).map((e) => e.id)).toEqual([z.id, y.id]);
  });
});

describe("the raw table's columns", () => {
  const keys = (form: Parameters<typeof buildFormSchema>[0], multi = false) => buildFormSchema(form, { multiEvent: multi }).columns.map((c) => c.key);

  it("Pit Scout has Team and Scout but no Match column; Lead Scout has Match and Alliance but no Team column", () => {
    expect(keys(PIT_SCOUT_FORM).slice(0, 2)).toEqual(["team", "scout"]);
    expect(keys(PIT_SCOUT_FORM)).not.toContain("match");
    expect(keys(LEAD_SCOUT_FORM).slice(0, 3)).toEqual(["match", "alliance", "scout"]);
    expect(keys(LEAD_SCOUT_FORM)).not.toContain("team");
    expect(keys(DRIVE_REFLECTION_FORM)).toContain("planDifferences");
  });

  it("adds an Event column only when several events are shown; the sticky columns come first", () => {
    expect(keys(HELPER_FORM)).not.toContain("event");
    expect(keys(HELPER_FORM, true)).toContain("event");
    const cols = buildFormSchema(MATCH_STRATEGY_FORM, { multiEvent: true }).columns;
    expect(cols.filter((c) => c.sticky).map((c) => c.key)).toEqual(["match", "alliance", "scout"]);
    expect(cols.findIndex((c) => c.key === "event")).toBeGreaterThan(cols.findIndex((c) => c.key === "scout"));
  });

  it("has no score or accuracy columns (these forms don't score), and the pit form has a Notes column", () => {
    for (const f of [PIT_SCOUT_FORM, TEAM_STRATEGY_FORM, HELPER_FORM]) expect(keys(f).some((k) => k === "scoreTotal" || k === "accuracy"), f.id).toBe(false);
    expect(keys(PIT_SCOUT_FORM)).toContain("stickyNotes");
  });

  it("exports a CSV with the sequence as a text flow and the matrix as Y/N cells", () => {
    const schema = buildFormSchema(PIT_SCOUT_FORM, { multiEvent: false });
    const row = formEntryToRow(entry({ values: { weight: 12, weightUnit: "kg", capabilities: { hive_auto: true, park_teleop: true }, autoCycle: ["leave", "hive", "park"] } }), PIT_SCOUT_FORM);
    const csv = entriesToCsv(schema, [row], (s) => s);
    expect(csv).toContain("Leave → Hive → Park");
    const header = csv.split("\r\n")[0].split(",");
    const rowCells = csv.split("\r\n")[1].split(",");
    const at = header.findIndex((h) => h.includes("Score into Hive / Autonomous"));
    expect(at).toBeGreaterThan(-1);
    expect(rowCells[at]).toBe("Y");
  });
});

describe("Lead Scout summary", () => {
  const lead = (values: FormEntry["values"], over: Partial<FormEntry> = {}) => entry({ formType: "lead-scout", formId: "lead-scout-v1", matchKey: "Q1", alliance: "red", values, ...over });

  it("reads the teams of the slots", () => {
    expect(slotTeams({ t1_team: 100, t2_team: 200, t3_team: "x" })).toEqual([{ slot: 1, team: 100 }, { slot: 2, team: 200 }]);
  });

  it("averages each team's skill over every rating, keeps the notes, and lists alliances with their skill", () => {
    const s = leadScoutSummary([
      lead({ t1_team: 100, t1_skill: 4, t1_notes: "fast", t2_team: 200, t2_skill: 2, allianceSkill: 3, allianceNotes: "ok" }),
      lead({ t1_team: 100, t1_skill: 2, t2_team: 300, t2_skill: 5 }, { matchKey: "Q2", scoutName: "Ben" }),
      lead({ t1_team: 100, t1_skill: 1 }, { excluded: true }),
    ]);
    expect(s.teams.find((t) => t.teamNumber === 100)).toMatchObject({ averageSkill: 3, entries: 2, notes: [{ text: "fast", scoutName: "Ada", matchKey: "Q1" }] });
    expect(s.teams.map((t) => t.teamNumber)).toEqual([100, 200, 300]);
    expect(s.alliances).toHaveLength(2);
    expect(s.alliances[0]).toMatchObject({ matchKey: "Q1", allianceSkill: 3, allianceNotes: "ok", teams: [100, 200] });
  });
});

describe("Pit Scout summary", () => {
  it("is the latest entry per team with weight in pounds, and counts the entries", () => {
    const rows = pitSummary(PIT, [
      entry({ teamNumber: 7, createdAtMs: 1, values: { cycleTime: 20 } }),
      entry({ teamNumber: 7, createdAtMs: 2, values: { cycleTime: 12.5, weight: 10, weightUnit: "kg", rookie: true, autoCycle: ["leave", "park"], capabilities: { park_auto: true } } }),
      entry({ teamNumber: 3, values: {} }),
      entry({ teamNumber: 9, excluded: true }),
    ]);
    expect(rows.map((r) => r.teamNumber)).toEqual([3, 7]);
    expect(rows[1]).toMatchObject({ cycleTime: 12.5, weightLb: 22, rookie: true, entryCount: 2, autoCycle: ["leave", "park"] });
    expect(rows[1].capabilities.park_auto).toBe(true);
    expect(rows[0]).toMatchObject({ cycleTime: null, rookie: null, photos: [], autoCycle: [] });
  });
});

describe("Team Strategy summary", () => {
  it("counts the teams per best-at (latest per team) and records abilities", () => {
    const t = (team: number, values: FormEntry["values"], at = 1) => entry({ formType: "team-strategy", teamNumber: team, values, createdAtMs: at });
    const s = teamStrategySummary({ unit: "team" }, [t(1, { bestAt: "hive" }, 1), t(1, { bestAt: "defense", canScoreHive: true }, 2), t(2, { bestAt: "defense" }), t(3, { bestAt: "flower", shootWhileMoving: true })]);
    expect(s.bestAtCounts).toEqual({ defense: 2, flower: 1 });
    expect(s.rows.find((r) => r.teamNumber === 1)).toMatchObject({ bestAt: "defense", entryCount: 2, abilities: { canScoreHive: true, shootWhileMoving: false } });
  });
});

describe("Match Strategy and Drive Reflection", () => {
  const strat = (matchKey: string, alliance: "red" | "blue", roles: [number, string, boolean][], over: Partial<FormEntry> = {}): FormEntry =>
    entry({ formType: "match-strategy", formId: "match-strategy-v1", matchKey, alliance, values: Object.fromEntries(roles.flatMap(([team, role, auto], i) => [[`t${i + 1}_team`, team], [`t${i + 1}_role`, role], [`t${i + 1}_auto`, auto]])), ...over });
  const refl = (matchKey: string, alliance: "red" | "blue", roles: [number, string, boolean][], over: Partial<FormEntry> = {}) => ({ ...strat(matchKey, alliance, roles, over), formType: "drive-reflection" as const, formId: "drive-reflection-v1" });

  it("lists the planned roles per match and alliance, ordered by match number", () => {
    const rows = planRows(PLAN, [strat("Q10", "red", [[1, "hive", true], [2, "defense", false]]), strat("Q2", "blue", [[3, "garden", false]])]);
    expect(rows.map((r) => r.matchKey)).toEqual(["Q2", "Q10"]);
    expect(rows[1].slots).toEqual([{ slot: 1, team: 1, role: "hive", auto: true }, { slot: 2, team: 2, role: "defense", auto: false }]);
  });

  it("pairs a reflection with its plan and marks the differences; % of matches that went to plan", () => {
    const plans = [strat("Q1", "red", [[1, "hive", true], [2, "defense", false]]), strat("Q2", "red", [[1, "hive", true]])];
    const refls = [refl("Q1", "red", [[1, "hive", true], [2, "garden", false]]), refl("Q2", "red", [[1, "hive", true]]), refl("Q3", "blue", [[9, "flower", false]])];
    const rows = reflectionRows(refls, plans, REFL);
    expect(rows.map((r) => [r.matchKey, r.plan !== null, r.differences.length])).toEqual([["Q1", true, 1], ["Q2", true, 0], ["Q3", false, 0]]);
    expect(rows[0].differences[0]).toEqual({ slot: 2, team: 2, planned: "defense", actual: "garden", field: "role" });
    expect(wentToPlan(rows)).toEqual({ planned: 2, onPlan: 1, percent: 50 });
    expect(wentToPlan([])).toEqual({ planned: 0, onPlan: 0, percent: null });
  });

  it("prefers the plan the reflection was linked to over the latest plan of that match", () => {
    const old = strat("Q1", "red", [[1, "garden", false]], { createdAtMs: 1 });
    const latest = strat("Q1", "red", [[1, "hive", false]], { createdAtMs: 2 });
    const r = refl("Q1", "red", [[1, "garden", false]], { linkedEntryId: old.id });
    expect(reflectionRows([r], [old, latest], REFL)[0].differences).toEqual([]);
  });
});

describe("Helper analytics", () => {
  it("is the log newest first with a success rate per scout", () => {
    const h = (scoutName: string, successful: string, at: number, over: Partial<FormEntry> = {}) => entry({ formType: "helper", scoutName, values: { successful }, createdAtMs: at, ...over });
    const a = helperAnalytics([h("Ada", "yes", 1), h("Ada", "no", 3), h("Ben", "yes", 2), h("Ben", "no", 4, { excluded: true })]);
    expect(a.log.map((e) => e.createdAtMs)).toEqual([3, 2, 1]);
    expect(a.perScout).toEqual([{ scoutName: "Ada", assists: 2, successful: 1, rate: 50 }, { scoutName: "Ben", assists: 1, successful: 1, rate: 100 }]);
    expect(a).toMatchObject({ total: 3, successful: 2, rate: 67 });
    expect(helperAnalytics([])).toMatchObject({ total: 0, rate: null, perScout: [] });
  });
});

describe("Team Profile: Pit and Strategy", () => {
  it("pulls the team's latest pit and strategy entries and its lead-scout skill, and says when there is nothing", () => {
    const entries = [
      entry({ teamNumber: 5, values: { cycleTime: 9 } }),
      entry({ formType: "team-strategy", teamNumber: 5, values: { bestAt: "hive" } }),
      entry({ formType: "lead-scout", values: { t1_team: 5, t1_skill: 4 } }),
      entry({ teamNumber: 6 }),
    ];
    const p = teamPitStrategy(5, entries);
    expect(p.pit?.cycleTime).toBe(9);
    expect(p.strategy?.bestAt).toBe("hive");
    expect(p).toMatchObject({ leadSkill: 4, leadRatings: 1, any: true });
    expect(teamPitStrategy(99, entries)).toMatchObject({ pit: null, strategy: null, leadSkill: null, any: false });
  });
});

describe("the Analytics tabs", () => {
  it("put the six form pages right after Match Scout Analytics, all under 'Raw data', before the other tabs", async () => {
    const { analyticsNav } = await import("@/lib/nav");
    const hrefs = analyticsNav.map((i) => i.href);
    expect(hrefs.slice(0, 7)).toEqual(["/analytics/match-scout", ...FORM_ANALYTICS_PAGES.map((p) => p.href)]);
    expect(analyticsNav.slice(0, 7).every((i) => i.group === "Raw data")).toBe(true);
    expect(analyticsNav.slice(7).every((i) => !i.group)).toBe(true);
    expect(hrefs).toContain("/analytics/scout-status");
  });
});
