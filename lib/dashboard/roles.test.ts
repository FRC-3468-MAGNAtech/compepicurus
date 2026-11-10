import { describe, expect, it } from "vitest";
import { ROLES, type RoleId } from "@/lib/roles";
import { ROLE_SOURCES, isRoleId, resolveViewRole, sourcesFor, userRoles } from "./roles";

describe("ROLE_SOURCES", () => {
  it("has an entry for every role in the roles config", () => {
    expect(Object.keys(ROLE_SOURCES).sort()).toEqual(ROLES.map((r) => r.id).sort());
  });

  it("only lists sources a role's widgets really use: roles built from entries and the FIRST API subscribe to nothing extra", () => {
    for (const role of ["drive-team", "media", "judge-awards"] as RoleId[]) {
      expect(ROLE_SOURCES[role]).toEqual([]);
    }
    // P29: the pit roles read the event's form entries (pit coverage, pit assists) and nothing else
    expect(ROLE_SOURCES["pit-scout"]).toEqual(["formEntries", "teamAssignments"]);
    expect(ROLE_SOURCES["pit-team"]).toEqual(["formEntries"]);
  });

  it("gives the scouting leads the roster, sessions, and assignments they report on", () => {
    expect(ROLE_SOURCES["lead-scout"]).toEqual(expect.arrayContaining(["members", "sessions", "attendance", "assignments"]));
    expect(ROLE_SOURCES["match-scout"]).toEqual(expect.arrayContaining(["assignments", "sessions", "members"]));
    expect(ROLE_SOURCES["lead-strategist"]).toEqual(["pickList", "formEntries", "teamAssignments"]);
  });
});

describe("sourcesFor", () => {
  it("is the role's sources, plus sessions for the admin strip", () => {
    expect([...sourcesFor("media", false)]).toEqual([]);
    expect([...sourcesFor("media", true)]).toEqual(["sessions"]);
    expect(sourcesFor("pit-scout", false).has("formEntries")).toBe(true);
    expect(sourcesFor("lead-scout", true).has("sessions")).toBe(true);
  });

  it("never lists a source twice", () => {
    const s = sourcesFor("team-coach", true);
    expect(s.size).toBe([...s].length);
  });

  it("only subscribes the pick list for the roles that show it", () => {
    for (const role of ROLES.map((r) => r.id)) {
      expect(sourcesFor(role, true).has("pickList")).toBe(role === "lead-strategist");
    }
  });
});

describe("userRoles / isRoleId", () => {
  it("puts the primary first and drops duplicates and unknown ids", () => {
    expect(userRoles("match-scout", ["media", "match-scout", "media"])).toEqual(["match-scout", "media"]);
    expect(userRoles("media", ["bogus" as RoleId])).toEqual(["media"]);
  });

  it("recognizes role ids", () => {
    expect(isRoleId("drive-team")).toBe(true);
    expect(isRoleId("nope")).toBe(false);
    expect(isRoleId(null)).toBe(false);
  });
});

describe("resolveViewRole", () => {
  const base = { primaryRole: "match-scout" as RoleId, secondaryRoles: ["drive-team", "media"] as RoleId[], saved: null, viewAs: null };

  it("defaults to the primary role", () => {
    expect(resolveViewRole(base)).toBe("match-scout");
  });

  it("restores the user's last choice among their own roles", () => {
    expect(resolveViewRole({ ...base, saved: "drive-team" })).toBe("drive-team");
    expect(resolveViewRole({ ...base, saved: "match-scout" })).toBe("match-scout");
  });

  it("ignores a remembered role the user no longer holds, or garbage", () => {
    expect(resolveViewRole({ ...base, saved: "lead-scout" })).toBe("match-scout");
    expect(resolveViewRole({ ...base, saved: "garbage" })).toBe("match-scout");
  });

  it("an admin's View-as preview wins over everything, even a role they don't hold", () => {
    expect(resolveViewRole({ ...base, saved: "drive-team", viewAs: "lead-strategist" })).toBe("lead-strategist");
  });
});
