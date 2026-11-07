import { describe, expect, it } from "vitest";
import {
  applyBulkAssignment,
  assignedFieldTeams,
  defaultMemberFieldTeamIds,
  draftsToFieldTeams,
  fieldTeamFullLabel,
  fieldTeamLabel,
  fieldTeamsWrite,
  isImplicitlyAllTeams,
  isOurTeam,
  matchesTeamFilter,
  membersAssignedTo,
  migratedFieldTeamId,
  moveItem,
  newFieldTeamId,
  parseFieldTeamNumber,
  planMemberMigration,
  planTeamMigration,
  readFieldTeams,
  planRemovals,
  resolveActiveFieldTeam,
  toDrafts,
  validateFieldTeamDrafts,
  type FieldTeam,
} from "./field-teams";

const A: FieldTeam = { id: "ft-35792", number: 35792, name: "Alpha" };
const B: FieldTeam = { id: "fteam_b", number: 35794, name: "Beta" };
const C: FieldTeam = { id: "fteam_c", number: 100, name: "" };
const TEAMS = [A, B, C];

describe("parseFieldTeamNumber", () => {
  it("accepts 1-5 digits and nothing else", () => {
    expect(parseFieldTeamNumber("35792")).toBe(35792);
    expect(parseFieldTeamNumber(" 7 ")).toBe(7);
    expect(parseFieldTeamNumber(100)).toBe(100);
    for (const bad of ["", "0", "00", "123456", "12.5", "-4", "ab12", null, undefined]) {
      expect(parseFieldTeamNumber(bad as string)).toBeNull();
    }
  });
});

describe("readFieldTeams", () => {
  it("reads fieldTeams in the stored order", () => {
    expect(readFieldTeams({ fieldTeams: [B, A] })).toEqual([B, A]);
  });
  it("falls back to the legacy single number/name until the migration has run", () => {
    expect(readFieldTeams({ number: 3468, name: "Old" })).toEqual([{ id: migratedFieldTeamId(3468), number: 3468, name: "Old" }]);
    expect(readFieldTeams({ number: 3468, name: null })).toEqual([{ id: "ft-3468", number: 3468, name: "" }]);
  });
  it("ignores malformed entries and falls back when none are valid", () => {
    expect(readFieldTeams({ fieldTeams: [{ id: "x" }, null, A] })).toEqual([A]);
    expect(readFieldTeams({ fieldTeams: [{ nope: 1 }], number: 12 })).toEqual([{ id: "ft-12", number: 12, name: "" }]);
  });
  it("is empty for no team or a team with nothing usable", () => {
    expect(readFieldTeams(null)).toEqual([]);
    expect(readFieldTeams({})).toEqual([]);
    expect(readFieldTeams({ number: 0 })).toEqual([]);
  });
});

describe("labels", () => {
  it("formats FTC <number> with an optional name", () => {
    expect(fieldTeamLabel(A)).toBe("FTC 35792");
    expect(fieldTeamFullLabel(A)).toBe("FTC 35792 · Alpha");
    expect(fieldTeamFullLabel(C)).toBe("FTC 100");
  });
  it("generates ids that cannot collide with migrated ones", () => {
    const id = newFieldTeamId();
    expect(id).toMatch(/^fteam_[0-9a-z]{8}$/);
    expect(id).not.toBe(migratedFieldTeamId(35792));
  });
});

describe("assignedFieldTeams", () => {
  it("returns the member's teams in the account's order", () => {
    expect(assignedFieldTeams(["fteam_b", "ft-35792"], TEAMS)).toEqual([A, B]);
  });
  it("counts a member with nothing (or only removed teams) as assigned to all", () => {
    expect(assignedFieldTeams(undefined, TEAMS)).toEqual(TEAMS);
    expect(assignedFieldTeams([], TEAMS)).toEqual(TEAMS);
    expect(assignedFieldTeams(["gone"], TEAMS)).toEqual(TEAMS);
    expect(isImplicitlyAllTeams([], TEAMS)).toBe(true);
    expect(isImplicitlyAllTeams(["ft-35792"], TEAMS)).toBe(false);
  });
});

describe("resolveActiveFieldTeam (the 'viewing as' team)", () => {
  it("defaults to the first assigned team", () => {
    expect(resolveActiveFieldTeam({ teams: TEAMS, userFieldTeamIds: ["fteam_b", "fteam_c"] })).toEqual(B);
    expect(resolveActiveFieldTeam({ teams: TEAMS, userFieldTeamIds: undefined })).toEqual(A);
  });
  it("honours a saved choice while the user is still assigned to it", () => {
    expect(resolveActiveFieldTeam({ teams: TEAMS, userFieldTeamIds: ["ft-35792", "fteam_b"], savedActiveId: "fteam_b" })).toEqual(B);
  });
  it("persists across reloads: the same saved id resolves to the same team", () => {
    const first = resolveActiveFieldTeam({ teams: TEAMS, savedActiveId: "fteam_c" });
    const second = resolveActiveFieldTeam({ teams: TEAMS, savedActiveId: "fteam_c" });
    expect(first).toEqual(C);
    expect(second).toEqual(first);
  });
  it("falls back when the viewed team was removed", () => {
    const after = TEAMS.filter((t) => t.id !== "fteam_b");
    expect(resolveActiveFieldTeam({ teams: after, userFieldTeamIds: ["ft-35792", "fteam_b"], savedActiveId: "fteam_b" })).toEqual(A);
  });
  it("falls back when the user is no longer assigned to the saved team", () => {
    expect(resolveActiveFieldTeam({ teams: TEAMS, userFieldTeamIds: ["ft-35792"], savedActiveId: "fteam_b" })).toEqual(A);
  });
  it("is null with no teams at all", () => {
    expect(resolveActiveFieldTeam({ teams: [] })).toBeNull();
  });
});

describe("isOurTeam", () => {
  it("is true for every FTC team on the account, not just one", () => {
    expect(isOurTeam(35792, TEAMS)).toBe(true);
    expect(isOurTeam(35794, TEAMS)).toBe(true);
    expect(isOurTeam(254, TEAMS)).toBe(false);
    expect(isOurTeam(null, TEAMS)).toBe(false);
    expect(isOurTeam(35792, [])).toBe(false);
  });
});

describe("validateFieldTeamDrafts", () => {
  const d = (id: string, number: string, name = "") => ({ id, number, name });
  it("passes a valid list (names optional)", () => {
    expect(validateFieldTeamDrafts([d("a", "35792", "Alpha"), d("b", "35794")])).toEqual([]);
  });
  it("blocks removing the last team and empties", () => {
    expect(validateFieldTeamDrafts([]).map((i) => i.field)).toEqual(["list"]);
  });
  it("flags bad and duplicate numbers on the right row", () => {
    const issues = validateFieldTeamDrafts([d("a", "35792"), d("b", "35792"), d("c", "123456"), d("e", "")]);
    expect(issues).toEqual([
      { id: "b", field: "number", message: "FTC 35792 is already on this account." },
      { id: "c", field: "number", message: "Enter a team number with 1 to 5 digits." },
      { id: "e", field: "number", message: "Enter a team number with 1 to 5 digits." },
    ]);
  });
  it("bounds names and the list size", () => {
    expect(validateFieldTeamDrafts([d("a", "1", "x".repeat(61))]).map((i) => i.field)).toEqual(["name"]);
    const eleven = Array.from({ length: 11 }, (_, i) => d(`t${i}`, String(i + 1)));
    expect(validateFieldTeamDrafts(eleven).some((i) => i.field === "list")).toBe(true);
  });
  it("round-trips drafts", () => {
    expect(draftsToFieldTeams([d("a", " 35792", " Alpha ")])).toEqual([{ id: "a", number: 35792, name: "Alpha" }]);
    expect(toDrafts([A])).toEqual([{ id: "ft-35792", number: "35792", name: "Alpha" }]);
  });
});

describe("moveItem / fieldTeamsWrite", () => {
  it("reorders and ignores out-of-range moves", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
  it("mirrors the first team into the legacy fields and the id list", () => {
    expect(fieldTeamsWrite([B, A])).toEqual({ fieldTeams: [B, A], fieldTeamIdList: ["fteam_b", "ft-35792"], fieldTeamNumbers: [35794, 35792], number: 35794, name: "Beta" });
    expect(fieldTeamsWrite([C]).name).toBeNull();
  });
});

describe("removal and bulk assignment", () => {
  const members = [
    { uid: "u1", fieldTeamIds: ["ft-35792", "fteam_b"] },
    { uid: "u2", fieldTeamIds: ["fteam_b"] },
    { uid: "u3", fieldTeamIds: ["ft-35792"] },
    { uid: "u4", fieldTeamIds: [] as string[] },
    { uid: "u5" },
  ];
  it("finds members who list the team explicitly", () => {
    expect(membersAssignedTo("fteam_b", members).map((m) => m.uid)).toEqual(["u1", "u2"]);
  });
  it("moves them to the target without duplicates", () => {
    expect(planRemovals({ fteam_b: "ft-35792" }, members, TEAMS)).toEqual([
      { uid: "u1", before: ["ft-35792", "fteam_b"], after: ["ft-35792"] },
      { uid: "u2", before: ["fteam_b"], after: ["ft-35792"] },
    ]);
  });
  it("follows a target that is itself removed, and handles several removals at once", () => {
    // B -> A, then A -> C: B's members end up on C (not on the removed A)
    const plan = planRemovals({ fteam_b: "ft-35792", "ft-35792": "fteam_c" }, members, TEAMS);
    expect(plan).toEqual([
      { uid: "u1", before: ["ft-35792", "fteam_b"], after: ["fteam_c"] },
      { uid: "u2", before: ["fteam_b"], after: ["fteam_c"] },
      { uid: "u3", before: ["ft-35792"], after: ["fteam_c"] },
    ]);
  });
  it("returns nothing when no member lists a removed team", () => {
    expect(planRemovals({ fteam_c: "ft-35792" }, members, TEAMS)).toEqual([]);
  });
  it("adds a team, keeping the account's order", () => {
    expect(applyBulkAssignment(["fteam_c"], "ft-35792", "add", TEAMS)).toEqual(["ft-35792", "fteam_c"]);
    expect(applyBulkAssignment(["ft-35792"], "ft-35792", "add", TEAMS)).toEqual(["ft-35792"]);
  });
  it("removes a team; an 'all teams' member keeps the rest", () => {
    expect(applyBulkAssignment(["ft-35792", "fteam_b"], "fteam_b", "remove", TEAMS)).toEqual(["ft-35792"]);
    expect(applyBulkAssignment(undefined, "fteam_b", "remove", TEAMS)).toEqual(["ft-35792", "fteam_c"]);
  });
  it("filters members by team (unassigned members match any team)", () => {
    expect(matchesTeamFilter(["ft-35792"], [], TEAMS)).toBe(true);
    expect(matchesTeamFilter(["ft-35792"], ["fteam_b"], TEAMS)).toBe(false);
    expect(matchesTeamFilter(["ft-35792", "fteam_b"], ["fteam_b"], TEAMS)).toBe(true);
    expect(matchesTeamFilter([], ["fteam_b"], TEAMS)).toBe(true);
  });
});

describe("migration planners (idempotent)", () => {
  it("builds fieldTeams from the legacy number, and defaults new members to all teams", () => {
    const plan = planTeamMigration({ number: 35792, name: "Alpha" });
    expect(plan).toEqual({ fieldTeams: [{ id: "ft-35792", number: 35792, name: "Alpha" }], fieldTeamIdList: ["ft-35792"], fieldTeamNumbers: [35792] });
    expect(defaultMemberFieldTeamIds({ number: 35792, name: "Alpha" })).toEqual(["ft-35792"]);
  });
  it("does nothing the second time", () => {
    const first = planTeamMigration({ number: 35792, name: "Alpha" })!;
    expect(planTeamMigration({ number: 35792, name: "Alpha", ...first })).toBeNull();
  });
  it("repairs a missing or stale id mirror without touching fieldTeams", () => {
    expect(planTeamMigration({ fieldTeams: [A, B] })).toEqual({ fieldTeams: [A, B], fieldTeamIdList: ["ft-35792", "fteam_b"], fieldTeamNumbers: [35792, 35794] });
    expect(planTeamMigration({ fieldTeams: [A, B], fieldTeamIdList: ["ft-35792"] })).not.toBeNull();
    expect(planTeamMigration({ fieldTeams: [A, B], fieldTeamIdList: ["ft-35792", "fteam_b"] })).not.toBeNull(); // the P20 numbers mirror is missing
    expect(planTeamMigration({ fieldTeams: [A, B], fieldTeamIdList: ["ft-35792", "fteam_b"], fieldTeamNumbers: [35792, 35794] })).toBeNull();
  });
  it("has nothing to migrate from when there is no number at all", () => {
    expect(planTeamMigration({})).toBeNull();
    expect(planTeamMigration(null)).toBeNull();
  });
  it("gives members without a list every team, and leaves existing assignments alone", () => {
    const plan = planMemberMigration([{ uid: "old" }, { uid: "set", fieldTeamIds: ["fteam_b"] }, { uid: "empty", fieldTeamIds: [] }], [A, B]);
    expect(plan).toEqual([{ uid: "old", fieldTeamIds: ["ft-35792", "fteam_b"] }]);
    // after applying it, a second pass is empty
    expect(planMemberMigration([{ uid: "old", fieldTeamIds: ["ft-35792", "fteam_b"] }], [A, B])).toEqual([]);
  });
});
