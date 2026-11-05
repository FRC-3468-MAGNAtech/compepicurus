import type { RoleId } from "@/lib/roles";

/** Roles (primary or secondary) that may edit the pick list, besides admins. Mirrored in firestore.rules' `canEditPickList()` — keep both in sync. */
export const PICK_LIST_EDITOR_ROLES: RoleId[] = ["lead-strategist", "lead-scout", "team-coach", "drive-team"];

export type PickListEditorProfile = { isAdmin: boolean; primaryRole: RoleId; secondaryRoles: RoleId[] };

/** Admins, or members whose primary OR secondary role is Lead Strategist, Lead Scout, Team Coach, or Drive Team. Everyone else sees the list read-only. */
export function canEditPickList(profile: PickListEditorProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.isAdmin) return true;
  return [profile.primaryRole, ...(profile.secondaryRoles ?? [])].some((r) => PICK_LIST_EDITOR_ROLES.includes(r));
}
