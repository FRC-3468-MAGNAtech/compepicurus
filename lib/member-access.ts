import { ROLES, type RoleId } from "@/lib/roles";

// Pure rules for who may edit whose roles/admin status in Team Management
// (FIX1-3). These mirror `firestore.rules`' `users/{uid}` update rules so the
// UI never offers something the rules would reject; the rules remain the
// actual enforcement (and are covered by emulator tests).

export type MemberAccess = {
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
};

type Member = MemberAccess & { uid: string; isOwner: boolean };
type Actor = { uid: string; isAdmin: boolean };

/** Why the admin switch can't be flipped for this member, or `null` when it can. */
export type AdminToggleBlock = "owner" | "self" | "last-admin" | null;

export type MemberEditState = {
  /** The Edit button is offered at all. */
  canEdit: boolean;
  /** Why editing is locked, for a tooltip; `null` when `canEdit`. */
  lockedReason: string | null;
  /** The admin switch inside the editor: `null` when it is usable. */
  adminToggleBlock: AdminToggleBlock;
};

export const ADMIN_TOGGLE_BLOCK_REASONS: Record<Exclude<AdminToggleBlock, null>, string> = {
  owner: "Owner status can't be changed here.",
  self: "Ask another admin to change your admin access — that way the team can never end up with none.",
  "last-admin": "At least one admin is required.",
};

/**
 * - non-admins edit nothing (their own row included);
 * - an owner's row is locked for everyone, the owner too;
 * - an admin may edit their own roles, but not remove their own admin flag
 *   (the rules' last-admin safeguard), and the sole admin can't be demoted.
 */
export function getMemberEditState(actor: Actor, member: Member, adminCount: number): MemberEditState {
  if (!actor.isAdmin) {
    return { canEdit: false, lockedReason: "Only admins can edit roles.", adminToggleBlock: "self" };
  }
  if (member.isOwner) {
    return { canEdit: false, lockedReason: "An owner's roles and admin status can't be changed.", adminToggleBlock: "owner" };
  }
  let adminToggleBlock: AdminToggleBlock = null;
  if (member.isAdmin && member.uid === actor.uid) adminToggleBlock = "self";
  else if (member.isAdmin && adminCount <= 1) adminToggleBlock = "last-admin";
  return { canEdit: true, lockedReason: null, adminToggleBlock };
}

const ROLE_ORDER = ROLES.map((r) => r.id);

/** Secondary roles in canonical (ROLES) order with the primary removed and duplicates dropped, so equal selections compare equal. */
export function normalizeSecondaryRoles(roles: RoleId[], primaryRole: RoleId): RoleId[] {
  const set = new Set(roles);
  return ROLE_ORDER.filter((id) => id !== primaryRole && set.has(id));
}

/** The fields that actually changed between two access states; empty when nothing did. */
export function diffMemberAccess(before: MemberAccess, after: MemberAccess): Partial<MemberAccess> {
  const beforeSecondary = normalizeSecondaryRoles(before.secondaryRoles, before.primaryRole);
  const afterSecondary = normalizeSecondaryRoles(after.secondaryRoles, after.primaryRole);

  const changes: Partial<MemberAccess> = {};
  if (before.primaryRole !== after.primaryRole) changes.primaryRole = after.primaryRole;
  // A primary-role change can swallow a secondary role (it can't be both), so compare against the stored list too.
  if (afterSecondary.join() !== beforeSecondary.join() || afterSecondary.length !== before.secondaryRoles.length) {
    changes.secondaryRoles = afterSecondary;
  }
  if (before.isAdmin !== after.isAdmin) changes.isAdmin = after.isAdmin;
  return changes;
}
