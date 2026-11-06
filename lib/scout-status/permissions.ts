import type { RoleId } from "@/lib/roles";

/** Roles (primary or secondary) that may edit scout targets, besides admins. Mirrored in firestore.rules' `canEditScoutTargets()` — keep both in sync. */
export const SCOUT_TARGET_EDITOR_ROLES: RoleId[] = ["lead-scout"];

export type ScoutTargetEditorProfile = { isAdmin: boolean; primaryRole: RoleId; secondaryRoles: RoleId[] };

/** Admins, or members whose primary OR secondary role is Lead Scout. Everyone else sees the setup read-only. */
export function canEditScoutTargets(profile: ScoutTargetEditorProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.isAdmin) return true;
  return [profile.primaryRole, ...(profile.secondaryRoles ?? [])].some((r) => SCOUT_TARGET_EDITOR_ROLES.includes(r));
}
