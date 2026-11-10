import { describe, expect, it } from "vitest";
import type { FormEntry } from "@/lib/form-entries-model";
import { allianceCoverage, allianceScoutRows, allianceUnits, checkableTeams, eligibleFormScouts, helperCountRows, resolveTeamTarget, statusEntries, teamCoverage, teamScoutRows } from "@/lib/scout-status/form-status";
import { scoutStatusFormTypes, scoutStatusFormType } from "@/lib/scout-status/form-types";
import { CATEGORY_IDS } from "@/lib/scout-status/categories";
import type { CategoryRecord, EventContext, StatusMatch } from "@/lib/scout-status/compute";

let n = 0;
const entry = (over: Partial<FormEntry>): FormEntry => ({
  id: `e${++n}`, teamId: "t", uid: "u1", scoutName: "Ada", formId: "x", formVersion: 1, formType: "pit-scout", eventCode: "A", teamNumber: null, values: {}, stickyNotes: [], flags: [], excluded: false, createdAtMs: n, updatedAtMs: n, ...over,
});
const match = (eventCode: string, number: number, category: StatusMatch["category"] = "qualification", matchType: StatusMatch["matchType"] = "Qualification"): StatusMatch => ({ key: `${eventCode}|${matchType}|${number}`, eventCode, matchType, matchNumber: number, category, label: `Q${number}`, played: true, red: [1, 2], blue: [3, 4] });
const ctx = (eventCode: string, matches: StatusMatch[]): EventContext => ({ eventCode, matches, categoryOf: () => "qualification", includes: () => true, hasSchedule: true, parsedRanges: {} as never });
const scouts = [{ uid: "u1", name: "Ada", role: "Lead Scout", inTargets: true }, { uid: "u2", name: "Ben", role: "Lead Scout", inTargets: true }];
const targets = (a: number | null, b: number | null) => new Map<string, CategoryRecord<number | null>>([["u1", Object.fromEntries(CATEGORY_IDS.map((c) => [c, c === "qualification" ? a : 0])) as CategoryRecord<number | null>], ["u2", Object.fromEntries(CATEGORY_IDS.map((c) => [c, c === "qualification" ? b : 0])) as CategoryRecord<number | null>]]);

describe("the registry", () => {
  it("enables every form type, with the right unit and target kind", () => {
    expect(scoutStatusFormTypes.every((t) => t.enabled)).toBe(true);
    const by = Object.fromEntries(scoutStatusFormTypes.map((t) => [t.id, [t.unit, t.targets]]));
    expect(by).toEqual({
      "match-scout": ["robot-match", "per-category-per-scout"],
      "lead-scout": ["match-alliance", "per-category-per-scout"],
      "match-strategy": ["match-alliance", "per-category-per-scout"],
      "drive-reflection": ["match-alliance", "per-category-per-scout"],
      "pit-scout": ["team", "teams-per-scout"],
      "team-strategy": ["team", "teams-per-scout"],
      helper: ["count", "none"],
    });
    expect(scoutStatusFormType("nope").id).toBe("match-scout");
  });
});

describe("alliance units (Lead Scout, Match Strategy, Drive Reflection)", () => {
  const units = allianceUnits([ctx("A", [match("A", 1), match("A", 2)]), ctx("B", [match("B", 1)])]);

  it("are Red and Blue of every match in range, per event", () => {
    expect(units.map((u) => u.key)).toEqual(["A|Q1|red", "A|Q1|blue", "A|Q2|red", "A|Q2|blue", "B|Q1|red", "B|Q1|blue"]);
    expect(units[0].teams).toEqual([1, 2]);
    expect(units[1].teams).toEqual([3, 4]);
  });

  it("are done when anyone scouted that alliance; several scouts on one count once", () => {
    const entries = [entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red" }), entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", uid: "u2" }), entry({ formType: "lead-scout", matchKey: "Q2", alliance: "blue", eventCode: "A" })];
    const cov = allianceCoverage(units, entries);
    expect(cov.filter((c) => c.done).map((c) => c.unit.key)).toEqual(["A|Q1|red", "A|Q2|blue"]);
    expect(cov[0].scouts).toEqual(["u1", "u2"]);
    // the same match number at another event is a different unit
    expect(cov.find((c) => c.unit.key === "B|Q1|red")?.done).toBe(false);
  });

  it("Drive Reflection: marks a plan with no reflection, and the most differences reported", () => {
    const plans = [entry({ formType: "match-strategy", matchKey: "Q1", alliance: "red" }), entry({ formType: "match-strategy", matchKey: "Q1", alliance: "blue" })];
    const refl = [entry({ formType: "drive-reflection", matchKey: "Q1", alliance: "red", planDifferences: 2 }), entry({ formType: "drive-reflection", matchKey: "Q1", alliance: "red", planDifferences: 1, uid: "u2" })];
    const cov = allianceCoverage(units, refl, plans);
    expect(cov[0]).toMatchObject({ done: true, planned: true, planWithoutReflection: false, differences: 2 });
    expect(cov[1]).toMatchObject({ done: false, planned: true, planWithoutReflection: true, differences: 0 });
    expect(cov[2]).toMatchObject({ planned: false, planWithoutReflection: false });
  });

  it("scout rows count distinct alliances per category against the per-category targets, and add anyone with an entry", () => {
    const entries = [
      entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", uid: "u1" }),
      entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", uid: "u1" }), // a second entry for the same alliance: one alliance
      entry({ formType: "lead-scout", matchKey: "Q1", alliance: "blue", uid: "u1" }),
      entry({ formType: "lead-scout", matchKey: "Q2", alliance: "red", uid: "stranger", scoutName: "Zed" }),
    ];
    const rows = allianceScoutRows({ scouts, entries, units, targets: targets(4, 2), playedFraction: 1, nameFor: (_u, f) => f });
    const ada = rows.find((r) => r.uid === "u1")!;
    expect(ada).toMatchObject({ alliances: 2, entries: 3, target: 4, status: "behind" }); // 2 of 4 with every match played
    expect(ada.byCategory.qualification).toEqual({ entries: 2, target: 4 });
    expect(rows.find((r) => r.uid === "u2")).toMatchObject({ alliances: 0, status: "not-started" });
    expect(rows.find((r) => r.uid === "stranger")).toMatchObject({ name: "Zed", inTargets: false, alliances: 1, target: null, status: "no-target" });
    expect(rows.map((r) => r.name)).toEqual(["Ada", "Ben", "Zed"]);
  });

  it("a scout who met their target is Complete", () => {
    const entries = [entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", uid: "u1" }), entry({ formType: "lead-scout", matchKey: "Q1", alliance: "blue", uid: "u1" })];
    expect(allianceScoutRows({ scouts, entries, units, targets: targets(2, 2), playedFraction: 1, nameFor: (_u, f) => f }).find((r) => r.uid === "u1")?.status).toBe("complete");
  });
});

describe("team units (Pit Scout, Team Strategy)", () => {
  it("our own teams are left out unless asked", () => {
    const ours = (t: number) => t === 111 || t === 222;
    expect(checkableTeams([333, 111, 222, 333, 444], ours, false)).toEqual([333, 444]);
    expect(checkableTeams([333, 111], ours, true)).toEqual([111, 333]);
  });

  it("coverage: a team is done when anyone did it; the latest photo is the thumbnail", () => {
    const photo = (url: string) => [{ url, pathname: "", size: 1, contentType: "image/jpeg" }];
    const cov = teamCoverage(
      [100, 200, 300],
      [entry({ teamNumber: 100, createdAtMs: 1, values: { photos: photo("old") } }), entry({ teamNumber: 100, createdAtMs: 2, uid: "u2", values: { photos: photo("new") } }), entry({ teamNumber: 200 })],
      new Map([[100, "Hundred"]])
    );
    expect(cov.map((c) => [c.teamNumber, c.done])).toEqual([[100, true], [200, true], [300, false]]);
    expect(cov[0]).toMatchObject({ name: "Hundred", photoUrl: "new" });
    expect([...cov[0].scouts].sort()).toEqual(["u1", "u2"]);
    expect(cov[1].photoUrl).toBeNull();
    expect(cov[2].entries).toEqual([]);
  });

  it("the teams-per-scout target: manual wins, then Assignments, then the single everyone number", () => {
    expect(resolveTeamTarget("u1", { all: 5, individual: { u1: 3 } }, 7)).toEqual({ value: 3, source: "manual" });
    expect(resolveTeamTarget("u1", { all: 5 }, 7)).toEqual({ value: 7, source: "assignments" });
    expect(resolveTeamTarget("u1", { all: 5 }, null)).toEqual({ value: 5, source: "all" });
    expect(resolveTeamTarget("u1", undefined, undefined)).toEqual({ value: null, source: "none" });
    expect(resolveTeamTarget("u1", { individual: { u1: 5000 } }, null).value).toBe(999);
  });

  it("scout rows count distinct teams per event against the target, summed across events", () => {
    const entries = [
      entry({ teamNumber: 1, uid: "u1" }),
      entry({ teamNumber: 1, uid: "u1" }), // twice for one team: one team
      entry({ teamNumber: 2, uid: "u1" }),
      entry({ teamNumber: 1, uid: "u1", eventCode: "B" }),
    ];
    const setups: Record<string, { all?: number }> = { A: { all: 2 }, B: { all: 3 } };
    const rows = teamScoutRows({ scouts, entries, setupFor: (c) => setups[c], eventCodes: ["A", "B"], assignedCounts: null, nameFor: (_u, f) => f });
    const ada = rows.find((r) => r.uid === "u1")!;
    expect(ada).toMatchObject({ teams: 3, entries: 4, target: { value: 5, source: "all" }, status: "on-track" });
    expect(rows.find((r) => r.uid === "u2")).toMatchObject({ teams: 0, status: "not-started" });
  });

  it("prefills from assignments (P31) and shows when a manual number overrides one scout", () => {
    const rows = teamScoutRows({ scouts, entries: [entry({ teamNumber: 1, uid: "u1" }), entry({ teamNumber: 2, uid: "u1" })], setupFor: () => ({ individual: { u2: 9 } }), eventCodes: ["A"], assignedCounts: new Map([["u1", 2], ["u2", 4]]), nameFor: (_u, f) => f });
    expect(rows.find((r) => r.uid === "u1")).toMatchObject({ target: { value: 2, source: "assignments" }, status: "complete" });
    expect(rows.find((r) => r.uid === "u2")?.target).toEqual({ value: 9, source: "manual" });
  });
});

describe("Helper counts", () => {
  it("counts assists and successes per person, most first", () => {
    const e = (uid: string, successful: string) => entry({ formType: "helper", uid, scoutName: uid, values: { successful } });
    const rows = helperCountRows({ scouts, entries: [e("u1", "yes"), e("u1", "no"), e("u2", "yes"), e("u3", "yes")], nameFor: (_u, f) => f });
    expect(rows.map((r) => [r.uid, r.assists, r.successful])).toEqual([["u1", 2, 1], ["u2", 1, 1], ["u3", 1, 1]]);
  });
});

describe("who is listed and which entries count", () => {
  it("lists attending members who can open the form's page, plus anyone added by hand", () => {
    const members = [{ uid: "a", name: "Ann", primaryRole: "pit-scout" }, { uid: "b", name: "Bo", primaryRole: "media" }, { uid: "c", name: "Cy", primaryRole: "media" }, { uid: "d", name: "Di", primaryRole: "pit-scout" }];
    const rows = eligibleFormScouts({ members, attendingUids: new Set(["a", "b"]), extraUids: new Set(["c"]), canAccess: (uid) => uid === "a" || uid === "d", roleLabel: (r) => r });
    expect(rows.map((r) => r.uid)).toEqual(["a", "c"]); // Bo attends but can't open the form; Di can but isn't attending
  });

  it("entries of other types, other events and excluded ones don't count", () => {
    const all = [entry({}), entry({ eventCode: "Z" }), entry({ excluded: true }), entry({ formType: "helper" })];
    expect(statusEntries(all, "pit-scout", ["A"])).toHaveLength(1);
  });
});
