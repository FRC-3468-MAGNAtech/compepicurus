import { describe, expect, it } from "vitest";
import { canEditMember, diffMemberAccess, getMemberEditState, normalizeSecondaryRoles } from "./member-access";

const member = (overrides: Partial<Parameters<typeof getMemberEditState>[1]> = {}) => ({
  uid: "m1",
  primaryRole: "match-scout" as const,
  secondaryRoles: [] as never[],
  isAdmin: false,
  isOwner: false,
  ...overrides,
});

const owner = { uid: "o1", isAdmin: true, isOwner: true };
const admin = { uid: "a1", isAdmin: true, isOwner: false };
const scout = { uid: "s1", isAdmin: false, isOwner: false };
const ownerRow = member({ uid: "o1", isOwner: true, isAdmin: true });

describe("canEditMember (the FIX2 matrix)", () => {
  it("owner: edits their own row", () => {
    expect(canEditMember(owner, ownerRow)).toEqual({ allowed: true, reason: null });
  });

  it("owner: edits every other member, including other admins", () => {
    expect(canEditMember(owner, member()).allowed).toBe(true);
    expect(canEditMember(owner, member({ uid: "a1", isAdmin: true })).allowed).toBe(true);
  });

  it("owner: cannot edit a second owner (only that owner can)", () => {
    const other = member({ uid: "o2", isOwner: true, isAdmin: true });
    const result = canEditMember(owner, other);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("admin (not owner): edits non-owner members and themselves", () => {
    expect(canEditMember(admin, member()).allowed).toBe(true);
    expect(canEditMember(admin, member({ uid: "x", isAdmin: true })).allowed).toBe(true);
    expect(canEditMember(admin, member({ uid: "a1", isAdmin: true })).allowed).toBe(true);
  });

  it("admin (not owner): cannot edit an owner, and is told why", () => {
    expect(canEditMember(admin, ownerRow)).toEqual({ allowed: false, reason: "Only the owner can edit this member." });
  });

  it("everyone else: edits nobody, their own row included, and is told why", () => {
    expect(canEditMember(scout, member()).allowed).toBe(false);
    expect(canEditMember(scout, member({ uid: "s1" })).allowed).toBe(false);
    expect(canEditMember(scout, ownerRow).reason).toBe("Only admins can edit roles.");
  });

  it("an owner whose admin flag is somehow off still manages members (the rules accept either flag)", () => {
    expect(canEditMember({ uid: "o1", isAdmin: false, isOwner: true }, member()).allowed).toBe(true);
  });
});

describe("getMemberEditState", () => {
  it("lets an admin edit another member, including their admin flag", () => {
    expect(getMemberEditState(admin, member(), 2)).toEqual({ canEdit: true, lockedReason: null, adminToggleBlock: null });
  });

  it("is read-only for a non-admin — their own row too — with a reason", () => {
    expect(getMemberEditState(scout, member({ uid: "s1" }), 2)).toMatchObject({ canEdit: false, lockedReason: "Only admins can edit roles." });
    expect(getMemberEditState(scout, member(), 2).canEdit).toBe(false);
  });

  it("locks an owner's row for other admins, with a reason", () => {
    expect(getMemberEditState(admin, ownerRow, 2)).toMatchObject({ canEdit: false, lockedReason: "Only the owner can edit this member." });
  });

  it("lets the owner edit their own row, with the admin switch locked on", () => {
    expect(getMemberEditState(owner, ownerRow, 1)).toEqual({ canEdit: true, lockedReason: null, adminToggleBlock: "owner" });
  });

  it("the sole owner and only member can edit their own roles (the FIX2 bug)", () => {
    // One member, who is the owner: adminCount is 1, and nothing about that may block the edit.
    expect(getMemberEditState(owner, ownerRow, 1).canEdit).toBe(true);
  });

  it("lets the owner change another admin's admin flag", () => {
    expect(getMemberEditState(owner, member({ uid: "x", isAdmin: true }), 2).adminToggleBlock).toBeNull();
  });

  it("lets an admin edit their own roles but not remove their own admin flag", () => {
    const state = getMemberEditState(admin, member({ uid: "a1", isAdmin: true }), 3);
    expect(state.canEdit).toBe(true);
    expect(state.adminToggleBlock).toBe("self");
  });

  it("last-admin safeguard: blocks only the admin switch for the final admin, never the edit itself", () => {
    const state = getMemberEditState(admin, member({ uid: "x", isAdmin: true }), 1);
    expect(state.canEdit).toBe(true);
    expect(state.adminToggleBlock).toBe("last-admin");
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
