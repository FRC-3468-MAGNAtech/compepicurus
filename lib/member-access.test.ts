import { describe, expect, it } from "vitest";
import { diffMemberAccess, getMemberEditState, normalizeSecondaryRoles } from "./member-access";

const member = (overrides: Partial<Parameters<typeof getMemberEditState>[1]> = {}) => ({
  uid: "m1",
  primaryRole: "match-scout" as const,
  secondaryRoles: [] as never[],
  isAdmin: false,
  isOwner: false,
  ...overrides,
});

const admin = { uid: "a1", isAdmin: true };
const scout = { uid: "s1", isAdmin: false };

describe("getMemberEditState", () => {
  it("lets an admin edit another member, including their admin flag", () => {
    expect(getMemberEditState(admin, member(), 2)).toEqual({ canEdit: true, lockedReason: null, adminToggleBlock: null });
  });

  it("is read-only for a non-admin — their own row too", () => {
    expect(getMemberEditState(scout, member({ uid: "s1" }), 2).canEdit).toBe(false);
    expect(getMemberEditState(scout, member(), 2).canEdit).toBe(false);
  });

  it("locks an owner's row for everyone, the owner included", () => {
    const owner = member({ uid: "o1", isOwner: true, isAdmin: true });
    expect(getMemberEditState(admin, owner, 2).canEdit).toBe(false);
    expect(getMemberEditState({ uid: "o1", isAdmin: true }, owner, 2).canEdit).toBe(false);
  });

  it("lets an admin edit their own roles but not remove their own admin flag", () => {
    const state = getMemberEditState(admin, member({ uid: "a1", isAdmin: true }), 3);
    expect(state.canEdit).toBe(true);
    expect(state.adminToggleBlock).toBe("self");
  });

  it("blocks demoting the last remaining admin", () => {
    expect(getMemberEditState(admin, member({ uid: "x", isAdmin: true }), 1).adminToggleBlock).toBe("last-admin");
  });

  it("still lets an admin be demoted by someone else while other admins remain", () => {
    expect(getMemberEditState(admin, member({ uid: "x", isAdmin: true }), 2).adminToggleBlock).toBeNull();
  });

  it("never blocks promoting a non-admin, even when there is only one admin", () => {
    expect(getMemberEditState(admin, member({ isAdmin: false }), 1).adminToggleBlock).toBeNull();
  });
});

describe("normalizeSecondaryRoles", () => {
  it("drops the primary, de-duplicates, and uses canonical order", () => {
    expect(normalizeSecondaryRoles(["media", "pit-scout", "media", "match-scout"], "match-scout")).toEqual(["pit-scout", "media"]);
  });
});

describe("diffMemberAccess", () => {
  const before = { primaryRole: "match-scout" as const, secondaryRoles: ["media" as const], isAdmin: false };

  it("is empty when nothing changed, whatever order the secondaries arrive in", () => {
    expect(diffMemberAccess(before, { ...before })).toEqual({});
    expect(diffMemberAccess({ ...before, secondaryRoles: ["media", "pit-scout"] }, { ...before, secondaryRoles: ["pit-scout", "media"] })).toEqual({});
  });

  it("reports only the fields that changed", () => {
    expect(diffMemberAccess(before, { ...before, isAdmin: true })).toEqual({ isAdmin: true });
    expect(diffMemberAccess(before, { ...before, primaryRole: "drive-team" })).toEqual({ primaryRole: "drive-team" });
    expect(diffMemberAccess(before, { ...before, secondaryRoles: ["media", "pit-team"] })).toEqual({ secondaryRoles: ["pit-team", "media"] });
  });

  it("removes a secondary role that has just become the primary", () => {
    expect(diffMemberAccess(before, { ...before, primaryRole: "media" })).toEqual({ primaryRole: "media", secondaryRoles: [] });
  });
});
