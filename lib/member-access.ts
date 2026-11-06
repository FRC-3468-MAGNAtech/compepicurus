import { ROLES, type RoleId } from "@/lib/roles";

// Pure rules for who may edit whose roles/admin status in Team Management
// (FIX1-3, reworked in FIX2). These mirror `firestore.rules`' `users/{uid}` update
// rule (`canManageMembers()` / `isOwner()`) so the UI never offers something the
// rules would reject; the rules remain the actual enforcement (and are covered by
// emulator tests).
//
// The matrix (FIX2):
//
//   Actor              | edits roles of              | changes the admin flag of
//   -------------------+-----------------------------+--------------------------------
//   Owner              | their own row + any         | any non-owner member (never
//                      | non-owner member            | their own: owner access stays)
//   Admin (not owner)  | any non-owner member,       | any non-owner member (never
//                      | themselves included         | their own)
//   Everyone else      | nobody                      | nobody
//
// An owner's row is editable only by that owner — another admin (or a second
// owner) can't touch it. Nobody can change `isOwner` or move a member off the team.

export type MemberAccess = {
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
};

type Member = MemberAccess & { uid: string; isOwner: boolean };
export type MemberActor = { uid: string; isAdmin: boolean; isOwner: boolean };

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
  owner: "Owner access can't be removed.",
  self: "Ask another admin to change your admin access — that way the team can never end up with none.",
  "last-admin": "At least one admin is required.",
};

/**
 * The single "may this actor edit this member?" check (the TypeScript twin of
 * firestore.rules' users/{uid} update rule). `reason` is a tooltip-ready
 * explanation when not allowed.
 */
export function canEditMember(actor: MemberActor, target: Pick<Member, "uid" | "isOwner">): { allowed: boolean; reason: string | null } {
  if (!actor.isAdmin && !actor.isOwner) return { allowed: false, reason: "Only admins can edit roles." };
  if (target.isOwner) {
    if (actor.isOwner && actor.uid === target.uid) return { allowed: true, reason: null };
    return { allowed: false, reason: actor.isOwner ? "Only this owner can edit their own roles." : "Only the owner can edit this member." };
  }
  return { allowed: true, reason: null };
}

/**
 * Edit button state plus the admin switch's block inside the editor. The
 * last-admin safeguard here only ever affects the admin switch — it never
 * blocks a role edit.
 */
export function getMemberEditState(actor: MemberActor, member: Member, adminCount: number): MemberEditState {
  const { allowed, reason } = canEditMember(actor, member);
  if (!allowed) return { canEdit: false, lockedReason: reason, adminToggleBlock: member.isOwner ? "owner" : "self" };

  let adminToggleBlock: AdminToggleBlock = null;
  if (member.isOwner) adminToggleBlock = "owner"; // the owner's own row: admin stays on
  else if (member.isAdmin && member.uid === actor.uid) adminToggleBlock = "self";
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
